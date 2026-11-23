/**
 * ENGINE-V2 §1.1: rank the candidates for one flagged (or covered) line. Pure. Ranking only: the line's flag state
 * comes from v1's computeFlags and is never read back or changed here.
 *
 *   match   = 100 × (strength × w.strength + fit × w.fit + quality × w.quality + price × w.price)
 *   fit     = integration_fit × f.integration_fit + job_fit × f.job_fit
 *   job_fit = category_match × j.category_match + function_match × j.function_match + keyword_match × j.keyword_match
 *   quality = clamp(rating_score × q.rating_score + volume_score × q.volume_score + award_boost, 0, 1)
 *
 * Every input is a part with its contribution to the match; the contributions add up to the match. A missing input
 * scores neutral and says so.
 */
import type { App, Rule, ScoringV2 } from "@/lib/catalog/load";
import type { V2App } from "./apps";
import { awardBoost } from "./awards";
import { categoryMatch } from "./category-match";
import { functionMatch } from "./function-match";
import { integrationFit } from "./integration-fit";
import { keywordMatch } from "./keyword-match";
import type { Input, Source } from "./part";
import { priceScore } from "./price";
import { categoryMeanRating, ratingScore } from "./rating";
import { maxReviews, volumeScore } from "./volume";

export type Part = {
  key: string;
  label: string;
  raw: unknown;
  normalised: number;
  /** This part's share of the whole match (weights multiplied down the tree). */
  weight: number;
  /** Points out of 100 this part adds. */
  contribution: number;
  missing: boolean;
  source?: Source;
  note?: string;
};

export type RankedV2 = {
  appId: string;
  name: string;
  rank: number;
  match: number;
  inUse: boolean;
  kind: "add" | "change" | null;
  /** The app's category handles the line (not only helps). Ranks first on an equal match. */
  handles: boolean;
  parts: Part[];
  formula: string;
  reason: string;
};

export type LineV2 = {
  lineKey: string;
  name: string;
  value: number;
  materiality: number;
  band: string;
  ruleId: string;
  ruleVersion: number;
  state: "flagged" | "covered";
  strengthNorm: number;
};

export type LineResult = {
  candidates: RankedV2[];
  excluded: { appId: string; name: string; reason: string }[];
  warnings: string[];
  /** Fewer than 3 candidates (not counting the app in use): a catalogue gap to queue. */
  gap: { ruleId: string; categories: string[]; markets: string[]; candidates: number } | null;
};

export type Ctx = {
  pool: V2App[];
  kept: App[];
  inUse: Set<string>;
  markets: string[];
  annualRevenue: number;
  headcount: number | null;
  year: number;
  scoring: ScoringV2;
};

export const MIN_CANDIDATES = 3;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const f2 = (n: number) => n.toFixed(2);

export function rankLine(line: LineV2, rule: Rule, ctx: Ctx): LineResult {
  const s = ctx.scoring;
  const excluded: LineResult["excluded"] = [];
  const set: { app: V2App; cat: Input; handles: boolean }[] = [];
  for (const app of ctx.pool) {
    const cat = categoryMatch(app, rule, s);
    if (!cat) continue;
    const used = ctx.inUse.has(app.id);
    if (!used && app.markets.length && !app.markets.some((m) => ctx.markets.includes(m))) {
      excluded.push({ appId: app.id, name: app.name, reason: `Not available in ${ctx.markets.join("/")} (listed for ${app.markets.join(", ")})` });
      continue;
    }
    set.push({ app, cat, handles: cat.normalised === s.category_match.covered_by });
  }

  const apps = set.map((x) => x.app);
  const mean = categoryMeanRating(apps);
  const max = maxReviews(apps);
  const kw = keywordMatch(rule.keywords, new Map(apps.map((a) => [a.id, a.listing?.description ?? null])), s);
  const w = s.weights;
  const share = {
    strength: w.strength,
    integration_fit: w.fit * s.fit.integration_fit,
    category_match: w.fit * s.fit.job_fit * s.job_fit.category_match,
    function_match: w.fit * s.fit.job_fit * s.job_fit.function_match,
    keyword_match: w.fit * s.fit.job_fit * s.job_fit.keyword_match,
    rating_score: w.quality * s.quality.rating_score,
    volume_score: w.quality * s.quality.volume_score,
    award_boost: w.quality,
    price: w.price,
  };

  const scored = set.map(({ app, cat, handles }) => {
    const inputs: Record<keyof typeof share, Input> = {
      strength: { raw: { strength_norm: line.strengthNorm, materiality: line.materiality, band: line.band }, normalised: line.strengthNorm, missing: false, note: `Line strength ${f2(line.strengthNorm)} (largest flag = 1)` },
      integration_fit: integrationFit(app, ctx.kept, s),
      category_match: cat,
      function_match: functionMatch(app, rule, s),
      keyword_match: kw.get(app.id)!,
      rating_score: ratingScore(app, mean, s),
      volume_score: volumeScore(app, max, s),
      award_boost: awardBoost(app, ctx.markets, ctx.year, s),
      price: priceScore(app, ctx.annualRevenue, ctx.headcount, s),
    };
    const v = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.normalised])) as Record<keyof typeof share, number>;
    const qualityRaw = s.quality.rating_score * v.rating_score + s.quality.volume_score * v.volume_score + v.award_boost;
    const excess = Math.max(0, qualityRaw - 1);
    const LABEL: Record<keyof typeof share, string> = {
      strength: "Strength",
      integration_fit: "Integration fit",
      category_match: "Category match",
      function_match: "Xero function match",
      keyword_match: "Keyword match",
      rating_score: "Xero rating",
      volume_score: "Review volume",
      award_boost: "Xero Awards boost",
      price: "Price",
    };
    const parts: Part[] = (Object.keys(share) as (keyof typeof share)[]).map((k) => {
      const i = inputs[k];
      let contribution = 100 * share[k] * i.normalised;
      if (k === "award_boost" && excess > 0) contribution -= 100 * share.award_boost * excess; // quality is capped at 1
      return { key: k, label: LABEL[k], raw: i.raw, normalised: r4(i.normalised), weight: r4(share[k]), contribution: r4(contribution), missing: i.missing, ...(i.source ? { source: i.source } : {}), ...(i.note ? { note: i.note } : {}) };
    });
    const match = Math.round(parts.reduce((t, p) => t + p.contribution, 0) * 100) / 100;
    const jobFit = s.job_fit.category_match * v.category_match + s.job_fit.function_match * v.function_match + s.job_fit.keyword_match * v.keyword_match;
    const formula =
      `100 × (${f2(w.strength)}×${f2(v.strength)} + ${f2(w.fit)}×(${f2(s.fit.integration_fit)}×${f2(v.integration_fit)} + ${f2(s.fit.job_fit)}×(${f2(s.job_fit.category_match)}×${f2(v.category_match)} + ${f2(s.job_fit.function_match)}×${f2(v.function_match)} + ${f2(s.job_fit.keyword_match)}×${f2(v.keyword_match)}))` +
      ` + ${f2(w.quality)}×min(1, ${f2(s.quality.rating_score)}×${f2(v.rating_score)} + ${f2(s.quality.volume_score)}×${f2(v.volume_score)} + ${f2(v.award_boost)}) + ${f2(w.price)}×${f2(v.price)}) = ${match.toFixed(2)}` +
      `  [job fit ${f2(jobFit)}]`;
    const used = ctx.inUse.has(app.id);
    const reasonBits = [
      used ? "You already pay for it" : null,
      inputs.category_match.note,
      inputs.integration_fit.missing ? null : inputs.integration_fit.note,
      inputs.rating_score.missing ? null : `Rated ${inputs.rating_score.note} on the Xero App Store`,
      inputs.price.missing ? "Price not published" : null,
    ].filter(Boolean);
    return { appId: app.id, name: app.name, rank: 0, match, inUse: used, kind: used ? null : line.state === "covered" ? ("change" as const) : ("add" as const), handles, parts, formula, reason: reasonBits.join(". ") };
  });

  // Ties (ENGINE-V2 §1.2): as v1, an app that handles the line first, then the app in use, then the name.
  scored.sort((a, b) => b.match - a.match || Number(b.handles) - Number(a.handles) || Number(b.inUse) - Number(a.inUse) || a.name.localeCompare(b.name));
  scored.forEach((x, i) => (x.rank = i + 1));

  const warnings: string[] = [];
  const others = scored.filter((x) => !x.inUse).length;
  let gap: LineResult["gap"] = null;
  if (others < MIN_CANDIDATES) {
    const cats = rule.covered_by ?? rule.app_categories;
    warnings.push(`Only ${others} candidate${others === 1 ? "" : "s"} for ${cats.join("/")} in ${ctx.markets.join("/")}: catalogue gap`);
    gap = { ruleId: rule.id, categories: cats, markets: ctx.markets, candidates: others };
  }
  const unknownMarkets = scored.filter((x) => !set.find((y) => y.app.id === x.appId)!.app.markets.length).length;
  if (unknownMarkets) warnings.push(`${unknownMarkets} candidate${unknownMarkets === 1 ? "" : "s"} with unknown markets kept (not read, not ruled out)`);
  return { candidates: scored, excluded, warnings, gap };
}

/** What recommendations_v2 stores per line: the top 10, plus the app in use if it ranks lower. */
export function shortlistV2(c: RankedV2[], n = 10): RankedV2[] {
  return [...c.slice(0, n), ...c.slice(n).filter((x) => x.inUse)];
}
