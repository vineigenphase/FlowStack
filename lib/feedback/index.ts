/**
 * "Is this right?" feedback on flags and the false-positive report (BACKEND.md §10, v1.1 D).
 *
 * Four answers besides "Yes, this is right":
 *   already_use_app → detection miss: line covered by a declared app; fingerprint_check item if we don't know the app
 *   no_app_needed   → false positive: line marked_fine; flag_disputed item
 *   numbers_wrong   → false positive (mapping/data): line queued; account_mapping item (flag_disputed for trends)
 *   not_now         → neither: line snoozed for 90 days
 *
 * Four figures (round-2 3b, 10 Nov), per rule and per week, over answered = yes + no_app_needed + numbers_wrong + already_use_app:
 *   false-positive rate = (no_app_needed + numbers_wrong with sub-reason wrong_category | figure_mismatch | one_off) ÷ answered
 *                         (a numbers_wrong from before sub-reasons existed counts here too)
 *   detection-miss rate = already_use_app ÷ answered
 *   data-quality rate   = numbers_wrong / miscoded ÷ answered   (their books, not our mistake)
 *   not now             = a count, in none of the rates
 * Each flag's latest answer counts. The pre-v1.1 "no" counts as no_app_needed. The eval gate uses the FP rate only.
 * TODO(NEXT-STEPS §6 item 5): whether `miscoded` stays out of the FP rate is PROPOSED (yes).
 *
 * UI-SPEC §5.7a (13 Nov 2026): "The numbers are wrong" carries a sub-reason. The line is queued either way; the
 * sub-reason picks the item our team gets (wrong_category / miscoded → account check, figure_mismatch / one_off →
 * flag_disputed) and one_off adds the line's "May be a one-off" note. undoFeedback() removes the latest answer.
 */
import { and, desc, eq } from "drizzle-orm";
import { flagFeedback, flags, lineOverrides, orgs, statements } from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { HttpError } from "@/lib/api";
import { enqueue } from "@/lib/queue/enqueue";
import { computeFlags } from "@/lib/signals/run";
import { apps as catalogApps } from "@/lib/catalog/load";
import { financialYear } from "@/lib/sync/periods";
import { addMonths } from "@/lib/detect/lifecycle";
import { checkFigure, figureOutcome, type FigureCheck } from "./figure-check";

export const ANSWERS = ["yes", "already_use_app", "no_app_needed", "numbers_wrong", "not_now"] as const;
export type Answer = (typeof ANSWERS)[number];
export const SUB_REASONS = ["wrong_category", "figure_mismatch", "one_off", "miscoded"] as const;
export type SubReason = (typeof SUB_REASONS)[number];
export const SNOOZE_DAYS = 90;

const ANSWERABLE = new Set(["flagged", "covered", "marked_fine", "snoozed", "queued"]);

/** Which org a flag belongs to (owner connection, so the route can check membership first). */
export async function flagOrg(flagId: string): Promise<string | null> {
  const db = await adminDb();
  const [f] = await db.select({ orgId: flags.orgId }).from(flags).where(eq(flags.id, flagId));
  return f?.orgId ?? null;
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);

export async function submitFeedback(opts: {
  orgId: string;
  flagId: string;
  userId: string | null;
  answer: Answer | "no";
  appId?: string;
  appName?: string;
  subReason?: SubReason;
  note?: string;
  now?: Date;
  /** Tests: stand in for the Xero re-fetch. */
  checkFigure?: (orgId: string, flagId: string) => Promise<FigureCheck>;
}) {
  const { orgId, flagId, userId, note } = opts;
  const answer: Answer = opts.answer === "no" ? "no_app_needed" : opts.answer;
  const known = opts.appId ? catalogApps().find((a) => a.id === opts.appId) : undefined;
  if (answer === "already_use_app" && !known && !opts.appName?.trim()) throw new HttpError(422, "Pick the app you use, or type its name");
  const appName = known?.name ?? opts.appName?.trim() ?? null;
  const subReason = answer === "numbers_wrong" ? (opts.subReason ?? null) : null;

  let feedbackRow: { id: string; createdAt: Date } | null = null;
  let periodEnd: string | null = null;
  const flag = await withOrg(orgId, async (tx) => {
    const [f] = await tx.select().from(flags).where(eq(flags.id, flagId));
    if (!f) throw new HttpError(404, "Flag not found");
    if (!ANSWERABLE.has(f.state) || !f.ruleId) throw new HttpError(422, `A ${f.state} line can't be answered`);
    const [row] = await tx.insert(flagFeedback).values({
      flagId, orgId, userId, lineKey: f.lineKey, ruleId: f.ruleId, ruleVersion: f.ruleVersion, answer,
      appId: known?.id ?? null, appName: answer === "already_use_app" ? appName : null, subReason, note: note ?? null,
    }).returning({ id: flagFeedback.id, createdAt: flagFeedback.createdAt });
    periodEnd = subReason === "one_off" ? await currentPeriodEnd(tx, orgId, f.runId, opts.now ?? new Date()) : null;
    await applyOverride(tx, { orgId, lineKey: f.lineKey, ruleId: f.ruleId, userId }, answer, known?.id ?? null, opts.now ?? new Date(), subReason, periodEnd);
    feedbackRow = row!;
    return f;
  });

  const ref = { org_id: orgId, line_key: flag.lineKey, rule_id: flag.ruleId };
  const tail = note ? `: ${note.slice(0, 300)}` : "";
  if (answer === "no_app_needed") {
    await enqueue({ kind: "flag_disputed", orgId, ref, reason: `"We don't need an app for this" on ${flag.lineKey} (rule ${flag.ruleId} v${flag.ruleVersion})${tail}` });
  }
  // Round-2 3b: a one-off is the business telling us what the line is; it's hidden for this period, no review needed.
  // Round-2 3b: "the amount isn't what our Xero shows" → re-fetch that report now and compare.
  let figure: { result: FigureCheck; message: string } | null = null;
  if (answer === "numbers_wrong" && subReason === "figure_mismatch") {
    const result = await (opts.checkFigure ?? checkFigure)(orgId, flagId);
    const out = figureOutcome(result, flag.lineKey);
    figure = { result, message: out.message };
    await enqueue({ kind: "flag_disputed", orgId, ref, reason: `${out.reason}${tail}`, priority: out.priority });
  } else if (answer === "numbers_wrong" && subReason !== "one_off") {
    const why = subReason ? ` (${subReason.replace("_", " ")})` : "";
    if (flag.xeroAccountId) {
      await enqueue({ kind: "account_mapping", orgId, ref: { org_id: orgId, xero_account_id: flag.xeroAccountId }, reason: `The business says ${flag.lineKey} isn't right. Check the account's category${tail}` });
    } else {
      await enqueue({ kind: "flag_disputed", orgId, ref, reason: `"The numbers are wrong"${why} on ${flag.lineKey} (rule ${flag.ruleId} v${flag.ruleVersion})${tail}` });
    }
  }
  if (answer === "already_use_app") {
    await enqueue({
      kind: "fingerprint_check",
      orgId,
      ref: { org_id: orgId, line_key: flag.lineKey, declared_app: known?.id ?? null, declared_name: appName },
      reason: known
        ? `The business says it uses ${known.name} for ${flag.lineKey}, but no payments to it show. Check its supplier names (detection miss).`
        : `The business says it uses "${appName}" for ${flag.lineKey}. It isn't in our catalogue: add it, with its supplier names.`,
    });
  }
  await computeFlags(orgId, flag.runId);
  const [after] = await withOrg(orgId, (tx) => tx.select({ id: flags.id, state: flags.state }).from(flags).where(eq(flags.id, flagId)));
  const message =
    subReason === "one_off" && periodEnd
      ? `Got it. We've hidden this line until ${fmtDate(periodEnd)}, the end of this financial year.`
      : figure
        ? figure.message
        : messageFor(answer, appName, known !== undefined, opts.now ?? new Date());
  return { flagId, feedbackId: feedbackRow!.id, createdAt: feedbackRow!.createdAt, answer, state: after?.state ?? null, message, figure: figure?.result ?? null };
}

type Tx = Parameters<Parameters<typeof withOrg>[1]>[0];

/** The last day of the financial year the flag's figures belong to (round-2 3b: a one-off is hidden for this period only). */
async function currentPeriodEnd(tx: Tx, orgId: string, runId: string, now: Date): Promise<string> {
  const [o] = await tx.select({ m: orgs.fyEndMonth, d: orgs.fyEndDay }).from(orgs).where(eq(orgs.id, orgId));
  const [pl] = await tx.select({ to: statements.periodTo }).from(statements).where(and(eq(statements.runId, runId), eq(statements.kind, "pl"))).limit(1);
  const asAt = pl?.to ?? now.toISOString().slice(0, 10);
  return addMonths(financialYear(asAt, o?.m ?? 3, o?.d ?? 31).priorEnd, 12);
}

/** The line override an answer leaves behind (replaces any earlier one for the same line and rule). */
async function applyOverride(
  tx: Tx,
  o: { orgId: string; lineKey: string; ruleId: string; userId: string | null },
  answer: Answer | "no",
  appId: string | null,
  now: Date,
  subReason?: string | null,
  periodEnd?: string | null,
) {
  const a = answer === "no" ? "no_app_needed" : answer;
  await tx.delete(lineOverrides).where(and(eq(lineOverrides.lineKey, o.lineKey), eq(lineOverrides.ruleId, o.ruleId)));
  if (a === "no_app_needed") await tx.insert(lineOverrides).values({ ...o, state: "marked_fine" });
  if (a === "not_now") await tx.insert(lineOverrides).values({ ...o, state: "snoozed", until: addDays(now, SNOOZE_DAYS) });
  // A one-off: fine until the current financial year ends, then judged afresh.
  if (a === "numbers_wrong" && subReason === "one_off") await tx.insert(lineOverrides).values({ ...o, state: "marked_fine", until: periodEnd ?? null });
  else if (a === "numbers_wrong") await tx.insert(lineOverrides).values({ ...o, state: "queued" });
  // A declared app we know covers the line now; an unknown name waits for our team to add it to the catalogue.
  if (a === "already_use_app" && appId) await tx.insert(lineOverrides).values({ ...o, state: "declared", appId });
}

const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** What happens next, in the user's words (UI-SPEC §5.7a "After submit"). */
export function messageFor(answer: Answer, appName: string | null, knownApp: boolean, now: Date): string {
  if (answer === "yes") return "Thanks. That helps us check our rules.";
  if (answer === "already_use_app")
    return knownApp ? `Got it. This line now counts as covered by ${appName}.` : `Thanks. We'll add ${appName} to our list and check this line again.`;
  if (answer === "no_app_needed") return "Got it. We've marked this line fine.";
  if (answer === "numbers_wrong") return "Thanks. We're checking this line. It shows as Checking until we have.";
  return `Got it. Hidden until ${fmtDate(addDays(now, SNOOZE_DAYS))}.`;
}

/**
 * Undo (UI-SPEC §5.7a): remove the latest answer on a flag and put back what the answer before it did. Items it
 * raised for our team stay in the queue (a person may already be looking). The deleted row leaves the
 * false-positive report with it.
 */
export async function undoFeedback(opts: { orgId: string; flagId: string; userId: string | null }) {
  const { orgId, flagId } = opts;
  const flag = await withOrg(orgId, async (tx) => {
    const [f] = await tx.select().from(flags).where(eq(flags.id, flagId));
    if (!f || !f.ruleId) throw new HttpError(404, "Flag not found");
    const [latest] = await tx.select().from(flagFeedback).where(eq(flagFeedback.flagId, flagId)).orderBy(desc(flagFeedback.createdAt)).limit(1);
    if (!latest) throw new HttpError(404, "No answer to undo");
    await tx.delete(flagFeedback).where(eq(flagFeedback.id, latest.id));
    // The previous answer on this line (any run) decides the override now.
    const [prev] = await tx
      .select()
      .from(flagFeedback)
      .where(and(eq(flagFeedback.lineKey, f.lineKey), eq(flagFeedback.ruleId, f.ruleId)))
      .orderBy(desc(flagFeedback.createdAt))
      .limit(1);
    const o = { orgId, lineKey: f.lineKey, ruleId: f.ruleId, userId: opts.userId };
    const prevEnd = prev?.subReason === "one_off" ? await currentPeriodEnd(tx, orgId, f.runId, prev.createdAt) : null;
    if (prev) await applyOverride(tx, o, prev.answer, prev.appId, prev.createdAt, prev.subReason, prevEnd);
    else await tx.delete(lineOverrides).where(and(eq(lineOverrides.lineKey, f.lineKey), eq(lineOverrides.ruleId, f.ruleId)));
    return f;
  });
  await computeFlags(orgId, flag.runId);
  const [after] = await withOrg(orgId, (tx) => tx.select({ state: flags.state }).from(flags).where(eq(flags.id, flagId)));
  return { flagId, state: after?.state ?? null, message: "Answer removed." };
}

export type Rate = {
  answered: number;
  falsePositives: number;
  misses: number;
  dataQuality: number;
  notNow: number;
  rate: number | null;
  missRate: number | null;
  dataQualityRate: number | null;
};

/** ISO week label, e.g. 2026-W45. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

type Row = { flagId: string; ruleId: string | null; ruleVersion: number | null; answer: string; subReason?: string | null; createdAt: Date };

/** Which figure an answer counts in (round-2 3b). */
type Bucket = "yes" | "fp" | "miss" | "dq" | "not_now";
export function bucketOf(answer: string, subReason?: string | null): Bucket {
  if (answer === "yes") return "yes";
  if (answer === "already_use_app") return "miss";
  if (answer === "not_now") return "not_now";
  if (answer === "numbers_wrong" && subReason === "miscoded") return "dq";
  return "fp"; // no / no_app_needed, numbers_wrong (wrong_category, figure_mismatch, one_off, or none recorded)
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function rateOf(buckets: Bucket[]): Rate {
  const c = (k: Bucket) => buckets.filter((b) => b === k).length;
  const fp = c("fp");
  const misses = c("miss");
  const dq = c("dq");
  const denom = c("yes") + fp + misses + dq;
  const r = (n: number) => (denom ? r3(n / denom) : null);
  return { answered: denom, falsePositives: fp, misses, dataQuality: dq, notNow: c("not_now"), rate: r(fp), missRate: r(misses), dataQualityRate: r(dq) };
}

/** Pure: latest answer per flag → overall, per rule (id@version) and per ISO week. */
export function fpReportFrom(rows: Row[]) {
  const latest = new Map<string, Row>();
  for (const r of rows) {
    const cur = latest.get(r.flagId);
    if (!cur || r.createdAt > cur.createdAt) latest.set(r.flagId, r);
  }
  const answers = [...latest.values()];
  const b = (a: Row) => bucketOf(a.answer, a.subReason);
  const group = (key: (a: Row) => string) => {
    const m = new Map<string, Bucket[]>();
    for (const a of answers) m.set(key(a), [...(m.get(key(a)) ?? []), b(a)]);
    return [...m].sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => ({ key: k, ...rateOf(v) }));
  };
  return {
    overall: rateOf(answers.map(b)),
    byRule: group((a) => `${a.ruleId ?? "(none)"}@v${a.ruleVersion ?? 0}`),
    byWeek: group((a) => isoWeek(a.createdAt)),
  };
}

export async function fpReport() {
  const db = await adminDb();
  const rows = await db
    .select({ flagId: flagFeedback.flagId, ruleId: flagFeedback.ruleId, ruleVersion: flagFeedback.ruleVersion, answer: flagFeedback.answer, subReason: flagFeedback.subReason, createdAt: flagFeedback.createdAt })
    .from(flagFeedback);
  return fpReportFrom(rows);
}
