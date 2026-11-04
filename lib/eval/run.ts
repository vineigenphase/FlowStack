/**
 * The labelled eval (BACKEND.md §10). Each /fixtures/labelled/<org>.json holds a chart of accounts,
 * report fixtures and the state a person expects for every line. We run the full pipeline on a fresh
 * in-memory database and compare.
 *
 *   FP rate          = predicted "flagged" that a person labelled anything else ÷ predicted "flagged"
 *   missed-flag rate = labelled "flagged" that we didn't flag ÷ labelled "flagged"
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { flags, orgs } from "@/db/schema";
import { migrateDb, openDb, setDbForTests, withOrg } from "@/lib/db/client";
import { MemoryXeroClient } from "@/lib/xero/client";
import { runRefresh } from "@/lib/sync/refresh";

const State = z.enum(["flagged", "covered", "fine", "marked_fine", "queued"]);
type State = z.infer<typeof State>;

export const LabelledOrg = z.object({
  name: z.string(),
  sample: z.literal(true),
  labelled_by: z.string(),
  now: z.string(),
  markets: z.array(z.string()).default(["UK"]),
  defaults: z.object({ pl: State, bs: State, cf: State }).default({ pl: "fine", bs: "fine", cf: "fine" }),
  expected: z.record(z.string(), State),
  why: z.record(z.string(), z.string()).default({}),
  xero: z.record(z.string(), z.unknown()),
});
export type LabelledOrg = z.infer<typeof LabelledOrg>;

export type LineResult = { org: string; lineKey: string; ruleId: string | null; predicted: State; expected: State; labelled: boolean };

export async function runLabelled(file: string): Promise<LineResult[]> {
  const l = LabelledOrg.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  const h = await openDb("memory://");
  try {
    await migrateDb(h);
    setDbForTests(h);
    const [o] = await h.db.insert(orgs).values({ name: l.name, sample: true, markets: l.markets }).returning();
    const { runId } = await runRefresh(o!.id, { client: new MemoryXeroClient(l.xero, o!.id), now: new Date(l.now) });
    const rows = await withOrg(o!.id, (tx) => tx.select().from(flags).where(eq(flags.runId, runId)));
    const name = path.basename(file, ".json");
    const results: LineResult[] = rows.map((f) => ({
      org: name,
      lineKey: f.lineKey,
      ruleId: f.ruleId,
      predicted: f.state,
      expected: l.expected[f.lineKey] ?? l.defaults[f.statementKind],
      labelled: f.lineKey in l.expected,
    }));
    // A label for a line the pipeline never produced is a mismatch too (e.g. a mapping went missing).
    for (const k of Object.keys(l.expected)) {
      if (!rows.some((r) => r.lineKey === k)) results.push({ org: name, lineKey: k, ruleId: null, predicted: "fine", expected: l.expected[k]!, labelled: true });
    }
    return results;
  } finally {
    setDbForTests(null);
    await h.close();
  }
}

export type RuleScore = { rule: string; predictedFlagged: number; falsePositives: number; labelledFlagged: number; missed: number; fpRate: number | null; missedRate: number | null };

const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);

/** Pure scoring over line results. */
export function scoreEval(results: LineResult[]) {
  const byRule = new Map<string, LineResult[]>();
  for (const r of results) {
    const k = r.ruleId ?? "(no rule)";
    byRule.set(k, [...(byRule.get(k) ?? []), r]);
  }
  const score = (rule: string, rs: LineResult[]): RuleScore => {
    const predictedFlagged = rs.filter((r) => r.predicted === "flagged").length;
    const falsePositives = rs.filter((r) => r.predicted === "flagged" && r.expected !== "flagged").length;
    const labelledFlagged = rs.filter((r) => r.expected === "flagged").length;
    const missed = rs.filter((r) => r.expected === "flagged" && r.predicted !== "flagged").length;
    return { rule, predictedFlagged, falsePositives, labelledFlagged, missed, fpRate: ratio(falsePositives, predictedFlagged), missedRate: ratio(missed, labelledFlagged) };
  };
  const rules = [...byRule].sort(([a], [b]) => a.localeCompare(b)).map(([k, rs]) => score(k, rs));
  const overall = score("overall", results);
  const agree = results.filter((r) => r.predicted === r.expected).length;
  return {
    overall,
    rules,
    stateAgreement: ratio(agree, results.length),
    mismatches: results.filter((r) => r.predicted !== r.expected),
  };
}

export function evalFiles(dir = path.resolve(process.cwd(), "fixtures/labelled")) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(dir, f)) : [];
}
