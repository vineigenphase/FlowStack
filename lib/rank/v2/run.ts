/**
 * ENGINE-V2 §1.3 shadow mode: rank v1's flags with engine v2. Reads the flag states v1 computed and never changes
 * them (a test enforces it). Pure apart from reading the repo's files (catalogue + app database).
 */
import { apps as catalogApps, rulesFile, type App, type Rule, type ScoringV2 } from "@/lib/catalog/load";
import type { FlagOut, LineIn } from "@/lib/signals/compute";
import { v2Apps, type V2App } from "./apps";
import { rankLine, type LineResult, type LineV2 } from "./score";

export type V2Input = {
  flags: FlagOut[];
  lines: Pick<LineIn, "lineKey" | "name">[];
  inUse: string[];
  markets: string[];
  annualRevenue: number;
  headcount: number | null;
  today: string;
  scoring?: ScoringV2;
  rules?: Rule[];
  pool?: V2App[];
  apps?: App[];
};

export type V2Line = { line: LineV2; rule: Rule; result: LineResult };

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** The lines v2 ranks: v1's flagged and covered lines (not "declared" ones, which v1 doesn't rank either). */
export function v2Lines(flags: FlagOut[], lines: V2Input["lines"]): LineV2[] {
  const names = new Map(lines.map((l) => [l.lineKey, l.name]));
  const max = Math.max(0, ...flags.filter((f) => f.state === "flagged").map((f) => f.strength));
  return flags
    .filter((f) => (f.state === "flagged" || f.state === "covered") && f.ruleId && !f.evidence.declared)
    .map((f) => ({
      lineKey: f.lineKey,
      name: names.get(f.lineKey) ?? f.lineKey,
      value: f.value,
      materiality: f.materiality,
      band: f.band,
      ruleId: f.ruleId!,
      ruleVersion: f.ruleVersion ?? 1,
      state: f.state as "flagged" | "covered",
      strengthNorm: max > 0 ? r4(f.strength / max) : 0,
    }));
}

export function rankFlagsV2(input: V2Input): V2Line[] {
  const rf = rulesFile();
  const scoring = input.scoring ?? rf.scoring_v2;
  if (!scoring) throw new Error("catalog/rules.yaml has no scoring_v2");
  const rules = input.rules ?? rf.rules;
  const apps = input.apps ?? catalogApps();
  const byId = new Map(apps.map((a) => [a.id, a]));
  const kept = input.inUse.map((id) => byId.get(id)).filter((a): a is App => !!a);
  const ctx = {
    pool: input.pool ?? v2Apps(),
    kept,
    inUse: new Set(input.inUse),
    markets: input.markets,
    annualRevenue: input.annualRevenue,
    headcount: input.headcount,
    year: Number(input.today.slice(0, 4)),
    scoring,
  };
  return v2Lines(input.flags, input.lines).flatMap((line) => {
    const rule = rules.find((r) => r.id === line.ruleId);
    return rule ? [{ line, rule, result: rankLine(line, rule, ctx) }] : [];
  });
}
