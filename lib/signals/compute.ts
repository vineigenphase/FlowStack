/**
 * Flags (BACKEND.md §7.2). Pure: lines + context in, one result per line out.
 *
 *   base         = revenue YTD (P&L and cash flow lines) | total assets (BS lines)
 *   materiality  = |value| / base
 *   band         = high ≥ HIGH_BAND | medium ≥ MED_BAND | low
 *   coverage_gap = 0   an app in use sits in the rule's covered_by categories → "covered"
 *                      (a better-ranked alternative is kept as evidence.switch_option, not a flag)
 *                = 0.5 an app in use only helps (in app_categories, not covered_by), e.g. a rota app for payroll
 *                = 1   no app in use in the rule's categories
 *   (Coverage rule v2, 2026-11-04 — replaced "0.5 when an in-use app is outranked", which flagged lines the
 *    business already pays to handle. See NOTES.md.)
 *   strength     = coverage_gap × materiality
 */
import type { App, Rule, Scoring } from "@/lib/catalog/load";
import { scoreCandidates, shortlistOf, type InUse, type PriceInfo, type Scored } from "@/lib/rank/score";

export type LineState = "flagged" | "covered" | "fine" | "marked_fine" | "queued";
export type Band = "high" | "medium" | "low";

export type LineIn = {
  kind: "pl" | "bs" | "cf";
  lineKey: string;
  xeroAccountId: string | null;
  code: string | null;
  name: string;
  category: string | null; // "unmapped" when the mapping is unsure
  value: number;
};

export type TbRow = { code: string | null; name: string; ytd_net: number; as_at: string };

export type FlagCtx = {
  revenue: number;
  totalAssets: number;
  monthsInPeriod: number;
  cfReconciled: boolean;
  rules: Rule[];
  apps: App[];
  markets: string[];
  inUse: Map<string, InUse>; // present apps only
  prices: Map<string, PriceInfo>;
  /** peer_results per app from verified reviews (0 to 1). Missing means neutral. */
  peer?: Map<string, number>;
  overrides: Set<string>; // `${lineKey}|${ruleId}`
  tb: Map<string, TbRow>; // by xeroAccountId
  bands: { high: number; medium: number };
  scoring: Scoring;
};

/** Recommendation kinds in 1.0 (v1.1 F). No "drop"; "fix" is reserved for 2.0 (needs transaction volumes). */
export type RecKind = "add" | "change";

export type FlagOut = {
  kind: LineIn["kind"];
  lineKey: string;
  xeroAccountId: string | null;
  ruleId: string | null;
  ruleVersion: number | null;
  value: number;
  base: number;
  materiality: number;
  band: Band;
  coverageGap: number;
  strength: number;
  state: LineState;
  evidence: Record<string, unknown>;
  cause: string | null;
  /** v1.1 F: `add` = nothing in use covers the line; `change` = an in-use app covers it and this one would replace it. The in-use app itself has kind null. */
  recommendations: (Scored & { rank: number; kind: RecKind | null })[];
};

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function bandOf(m: number, b: FlagCtx["bands"]): Band {
  return m >= b.high ? "high" : m >= b.medium ? "medium" : "low";
}

export function ruleFor(rules: Rule[], category: string | null, kind: LineIn["kind"]): Rule | null {
  if (!category) return null;
  return rules.find((r) => r.account_categories.includes(category) && r.statements.includes(kind)) ?? null;
}

export function computeFlags(lines: LineIn[], ctx: FlagCtx): FlagOut[] {
  const appsById = new Map(ctx.apps.map((a) => [a.id, a]));
  const kept = [...ctx.inUse.keys()].map((id) => appsById.get(id)).filter(Boolean) as App[];
  const annualRevenue = ctx.monthsInPeriod > 0 ? (ctx.revenue * 12) / ctx.monthsInPeriod : ctx.revenue;

  type Work = FlagOut & { rule: Rule | null; candidates: App[] };
  const work: Work[] = lines.map((l) => {
    const base = l.kind === "bs" ? ctx.totalAssets : ctx.revenue;
    const materiality = base ? r4(Math.abs(l.value) / Math.abs(base)) : 0;
    const rule = ruleFor(ctx.rules, l.category, l.kind);
    const detectedInArea = rule
      ? kept.filter((a) => a.categories.some((c) => rule.app_categories.includes(c))).map((a) => ({ app: a.id, ...pick(ctx.inUse.get(a.id)!) }))
      : [];
    const tb = l.xeroAccountId ? (ctx.tb.get(l.xeroAccountId) ?? null) : null;
    const w: Work = {
      kind: l.kind,
      lineKey: l.lineKey,
      xeroAccountId: l.xeroAccountId,
      ruleId: rule?.id ?? null,
      ruleVersion: rule?.version ?? null,
      value: l.value,
      base,
      materiality,
      band: bandOf(materiality, ctx.bands),
      coverageGap: 0,
      strength: 0,
      state: "fine",
      cause: rule?.cause ?? null,
      evidence: {
        trial_balance: tb,
        statement_value: l.value,
        base_label: l.kind === "bs" ? "Total assets" : "Revenue",
        base_value: base,
        materiality,
        detected_in_area: detectedInArea,
        rule_id: rule?.id ?? null,
        rule_version: rule?.version ?? null,
      },
      recommendations: [],
      rule,
      candidates: [],
    };

    // Order matters: "not sure" beats everything; a user's "Not a problem" beats a computed flag.
    if (l.xeroAccountId && (!l.category || l.category === "unmapped")) w.state = "queued";
    else if (l.kind === "cf" && !ctx.cfReconciled) w.state = "queued";
    else if (!rule || rule.app_categories.length === 0) w.state = "fine";
    else if (Math.abs(l.value) < rule.min_value_gbp) w.state = "fine";
    else if (ctx.overrides.has(`${l.lineKey}|${rule.id}`)) w.state = "marked_fine";
    else {
      w.state = "flagged";
      const eligible = ctx.apps.filter(
        (a) => a.categories.some((c) => rule.app_categories.includes(c)) && a.markets.some((m) => ctx.markets.includes(m)),
      );
      // The detected app is always a candidate, even outside the org's markets.
      for (const d of detectedInArea) if (!eligible.some((a) => a.id === d.app)) eligible.push(appsById.get(d.app)!);
      w.candidates = eligible;
      const coveredBy = rule.covered_by ?? rule.app_categories;
      const covering = kept.filter((a) => a.categories.some((c) => coveredBy.includes(c)));
      if (covering.length) {
        w.state = "covered";
        w.coverageGap = 0;
      } else {
        w.coverageGap = detectedInArea.length ? 0.5 : 1;
      }
    }
    return w;
  });

  for (const w of work) if (w.state === "flagged") w.strength = r4(w.coverageGap * w.materiality);

  const maxStrength = Math.max(0, ...work.filter((w) => w.state === "flagged").map((w) => w.strength));
  for (const w of work) {
    if (w.state !== "flagged" && w.state !== "covered") continue;
    const strengthNorm = maxStrength > 0 ? r4(w.strength / maxStrength) : 0;
    const scored = scoreCandidates({ candidates: w.candidates, strengthNorm, kept, inUse: ctx.inUse, prices: ctx.prices, peer: ctx.peer, annualRevenue, scoring: ctx.scoring });
    const kindOf = (s: Scored): RecKind | null => (s.inUse ? null : w.state === "covered" ? "change" : "add");
    w.recommendations = shortlistOf(scored).map((s, i) => ({ ...s, rank: i + 1, kind: kindOf(s) }));
    if (w.state === "covered") {
      const rule = w.rule!;
      const coveredBy = rule.covered_by ?? rule.app_categories;
      const by = scored.find((x) => x.inUse && appsById.get(x.appId)!.categories.some((c) => coveredBy.includes(c)))!;
      w.evidence.covered_by = by.appId;
      // Not a flag: an alternative that does the same job and ranks higher than what they already pay for.
      const sameJob = scored.filter((x) => appsById.get(x.appId)!.categories.some((c) => coveredBy.includes(c)));
      const alt = sameJob[0];
      if (alt && !alt.inUse && alt.match > by.match) w.evidence.switch_option = { app: alt.appId, match: alt.match, in_use_match: by.match, reason: alt.reason };
    }
  }

  return work.map((w) => {
    const { rule, candidates, ...out } = w;
    void rule;
    void candidates;
    return out;
  });
}

function pick(u: InUse) {
  return { spend_12m: u.spend12m, months_seen: u.monthsSeen };
}

const STATE_ORDER: Record<LineState, number> = { flagged: 0, covered: 1, queued: 2, marked_fine: 3, fine: 4 };

/** Flagged by |value| desc (the cost of getting it wrong), then covered, then the rest. */
export function orderFlags<T extends { state: LineState; value: number }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || Math.abs(b.value) - Math.abs(a.value));
}

/** Hero number: Σ |value| of flagged P&L cost lines (revenue categories excluded). */
export function atStake(flags: Pick<FlagOut, "kind" | "state" | "value" | "lineKey">[], categoryOf: (lineKey: string) => string | null, revenueCategories: Set<string>) {
  return flags
    .filter((f) => f.kind === "pl" && f.state === "flagged" && !revenueCategories.has(categoryOf(f.lineKey) ?? ""))
    .reduce((s, f) => s + Math.abs(f.value), 0);
}
