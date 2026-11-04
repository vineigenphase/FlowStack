/**
 * "Is this right?" feedback on flags and the false-positive report (BACKEND.md §10).
 * FP rate = count(no) / count(answered), using each flag's latest answer.
 */
import { and, eq } from "drizzle-orm";
import { flagFeedback, flags, lineOverrides } from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { HttpError } from "@/lib/api";
import { enqueue } from "@/lib/queue/enqueue";
import { computeFlags } from "@/lib/signals/run";

const ANSWERABLE = new Set(["flagged", "covered", "marked_fine"]);

/** Which org a flag belongs to (owner connection, so the route can check membership first). */
export async function flagOrg(flagId: string): Promise<string | null> {
  const db = await adminDb();
  const [f] = await db.select({ orgId: flags.orgId }).from(flags).where(eq(flags.id, flagId));
  return f?.orgId ?? null;
}

export async function submitFeedback(opts: { orgId: string; flagId: string; userId: string | null; answer: "yes" | "no"; note?: string }) {
  const { orgId, flagId, userId, answer, note } = opts;
  const flag = await withOrg(orgId, async (tx) => {
    const [f] = await tx.select().from(flags).where(eq(flags.id, flagId));
    if (!f) throw new HttpError(404, "Flag not found");
    if (!ANSWERABLE.has(f.state) || !f.ruleId) throw new HttpError(422, `A ${f.state} line can't be answered`);
    await tx.insert(flagFeedback).values({ flagId, orgId, userId, lineKey: f.lineKey, ruleId: f.ruleId, ruleVersion: f.ruleVersion, answer, note: note ?? null });
    if (answer === "no") {
      await tx.insert(lineOverrides).values({ orgId, lineKey: f.lineKey, ruleId: f.ruleId, userId }).onConflictDoNothing();
    } else {
      // "Yes, this is a problem" undoes an earlier "Not a problem".
      await tx.delete(lineOverrides).where(and(eq(lineOverrides.lineKey, f.lineKey), eq(lineOverrides.ruleId, f.ruleId)));
    }
    return f;
  });

  if (answer === "no") {
    await enqueue({
      kind: "flag_disputed",
      orgId,
      ref: { org_id: orgId, line_key: flag.lineKey, rule_id: flag.ruleId },
      reason: `"Not a problem" on ${flag.lineKey} (rule ${flag.ruleId} v${flag.ruleVersion})${note ? `: ${note.slice(0, 300)}` : ""}`,
    });
  }
  await computeFlags(orgId, flag.runId);
  const [after] = await withOrg(orgId, (tx) => tx.select({ id: flags.id, state: flags.state }).from(flags).where(eq(flags.id, flagId)));
  return { flagId, answer, state: after?.state ?? null };
}

export type Rate = { answered: number; no: number; rate: number | null };
const rate = (answered: number, no: number): Rate => ({ answered, no, rate: answered ? Math.round((no / answered) * 1000) / 1000 : null });

/** ISO week label, e.g. 2026-W45. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

type Answer = { flagId: string; ruleId: string | null; ruleVersion: number | null; answer: "yes" | "no"; createdAt: Date };

/** Pure: latest answer per flag → overall, per rule (id@version) and per ISO week. */
export function fpReportFrom(rows: Answer[]) {
  const latest = new Map<string, Answer>();
  for (const r of rows) {
    const cur = latest.get(r.flagId);
    if (!cur || r.createdAt > cur.createdAt) latest.set(r.flagId, r);
  }
  const answers = [...latest.values()];
  const group = (key: (a: Answer) => string) => {
    const m = new Map<string, { answered: number; no: number }>();
    for (const a of answers) {
      const g = m.get(key(a)) ?? { answered: 0, no: 0 };
      g.answered++;
      if (a.answer === "no") g.no++;
      m.set(key(a), g);
    }
    return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ key: k, ...rate(v.answered, v.no) }));
  };
  return {
    overall: rate(answers.length, answers.filter((a) => a.answer === "no").length),
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
