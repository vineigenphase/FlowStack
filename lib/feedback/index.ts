/**
 * "Is this right?" feedback on flags and the false-positive report (BACKEND.md §10, v1.1 D).
 *
 * Four answers besides "Yes, this is right":
 *   already_use_app → detection miss: line covered by a declared app; fingerprint_check item if we don't know the app
 *   no_app_needed   → false positive: line marked_fine; flag_disputed item
 *   numbers_wrong   → false positive (mapping/data): line queued; account_mapping item (flag_disputed for trends)
 *   not_now         → neither: line snoozed for 90 days
 *
 *   false-positive rate = (no_app_needed + numbers_wrong) ÷ (yes + no_app_needed + numbers_wrong + already_use_app)
 *   detection miss rate = already_use_app ÷ same denominator;  not_now is a count, in neither.
 * Each flag's latest answer counts. The pre-v1.1 "no" counts as no_app_needed.
 * TODO(CHANGES-v1.1.md §4 item 5): the four answers and which count as false positives are PROPOSED.
 */
import { and, eq } from "drizzle-orm";
import { flagFeedback, flags, lineOverrides } from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { HttpError } from "@/lib/api";
import { enqueue } from "@/lib/queue/enqueue";
import { computeFlags } from "@/lib/signals/run";
import { apps as catalogApps } from "@/lib/catalog/load";

export const ANSWERS = ["yes", "already_use_app", "no_app_needed", "numbers_wrong", "not_now"] as const;
export type Answer = (typeof ANSWERS)[number];
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
  note?: string;
  now?: Date;
}) {
  const { orgId, flagId, userId, note } = opts;
  const answer: Answer = opts.answer === "no" ? "no_app_needed" : opts.answer;
  const known = opts.appId ? catalogApps().find((a) => a.id === opts.appId) : undefined;
  if (answer === "already_use_app" && !known && !opts.appName?.trim()) throw new HttpError(422, "Pick the app you use, or type its name");
  const appName = known?.name ?? opts.appName?.trim() ?? null;

  const flag = await withOrg(orgId, async (tx) => {
    const [f] = await tx.select().from(flags).where(eq(flags.id, flagId));
    if (!f) throw new HttpError(404, "Flag not found");
    if (!ANSWERABLE.has(f.state) || !f.ruleId) throw new HttpError(422, `A ${f.state} line can't be answered`);
    await tx.insert(flagFeedback).values({
      flagId, orgId, userId, lineKey: f.lineKey, ruleId: f.ruleId, ruleVersion: f.ruleVersion, answer,
      appId: known?.id ?? null, appName: answer === "already_use_app" ? appName : null, note: note ?? null,
    });
    const where = and(eq(lineOverrides.lineKey, f.lineKey), eq(lineOverrides.ruleId, f.ruleId));
    await tx.delete(lineOverrides).where(where);
    const o = { orgId, lineKey: f.lineKey, ruleId: f.ruleId, userId };
    if (answer === "no_app_needed") await tx.insert(lineOverrides).values({ ...o, state: "marked_fine" });
    if (answer === "not_now") await tx.insert(lineOverrides).values({ ...o, state: "snoozed", until: addDays(opts.now ?? new Date(), SNOOZE_DAYS) });
    if (answer === "numbers_wrong") await tx.insert(lineOverrides).values({ ...o, state: "queued" });
    // A declared app we know covers the line now; an unknown name waits for our team to add it to the catalogue.
    if (answer === "already_use_app" && known) await tx.insert(lineOverrides).values({ ...o, state: "declared", appId: known.id });
    return f;
  });

  const ref = { org_id: orgId, line_key: flag.lineKey, rule_id: flag.ruleId };
  const tail = note ? `: ${note.slice(0, 300)}` : "";
  if (answer === "no_app_needed") {
    await enqueue({ kind: "flag_disputed", orgId, ref, reason: `"We don't need an app for this" on ${flag.lineKey} (rule ${flag.ruleId} v${flag.ruleVersion})${tail}` });
  }
  if (answer === "numbers_wrong") {
    if (flag.xeroAccountId) {
      await enqueue({ kind: "account_mapping", orgId, ref: { org_id: orgId, xero_account_id: flag.xeroAccountId }, reason: `The business says ${flag.lineKey} isn't right. Check the account's category${tail}` });
    } else {
      await enqueue({ kind: "flag_disputed", orgId, ref, reason: `"This figure isn't right" on ${flag.lineKey} (rule ${flag.ruleId} v${flag.ruleVersion})${tail}` });
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
  return { flagId, answer, state: after?.state ?? null };
}

export type Rate = { answered: number; falsePositives: number; misses: number; notNow: number; rate: number | null; missRate: number | null };

/** ISO week label, e.g. 2026-W45. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

type Row = { flagId: string; ruleId: string | null; ruleVersion: number | null; answer: string; createdAt: Date };

const norm = (a: string): Answer => (a === "no" ? "no_app_needed" : (a as Answer));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function rateOf(answers: Answer[]): Rate {
  const c = (k: Answer) => answers.filter((a) => a === k).length;
  const fp = c("no_app_needed") + c("numbers_wrong");
  const misses = c("already_use_app");
  const denom = c("yes") + fp + misses;
  return { answered: denom, falsePositives: fp, misses, notNow: c("not_now"), rate: denom ? r3(fp / denom) : null, missRate: denom ? r3(misses / denom) : null };
}

/** Pure: latest answer per flag → overall, per rule (id@version) and per ISO week. */
export function fpReportFrom(rows: Row[]) {
  const latest = new Map<string, Row>();
  for (const r of rows) {
    const cur = latest.get(r.flagId);
    if (!cur || r.createdAt > cur.createdAt) latest.set(r.flagId, r);
  }
  const answers = [...latest.values()];
  const group = (key: (a: Row) => string) => {
    const m = new Map<string, Answer[]>();
    for (const a of answers) m.set(key(a), [...(m.get(key(a)) ?? []), norm(a.answer)]);
    return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ key: k, ...rateOf(v) }));
  };
  return {
    overall: rateOf(answers.map((a) => norm(a.answer))),
    byRule: group((a) => `${a.ruleId ?? "(none)"}@v${a.ruleVersion ?? 0}`),
    byWeek: group((a) => isoWeek(a.createdAt)),
  };
}

export async function fpReport() {
  const db = await adminDb();
  const rows = await db
    .select({ flagId: flagFeedback.flagId, ruleId: flagFeedback.ruleId, ruleVersion: flagFeedback.ruleVersion, answer: flagFeedback.answer, createdAt: flagFeedback.createdAt })
    .from(flagFeedback);
  return fpReportFrom(rows);
}
