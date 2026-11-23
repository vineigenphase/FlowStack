/**
 * ENGINE-V2 §1.3: the trace for one flagged line, for the dev panel and GET /api/dev/engine/:org/:lineKey.
 * v2 traces are recomputed from the line and the current files; v1 traces are read from the stored recommendations.
 */
import { ScoringV2, type Scoring } from "@/lib/catalog/load";
import type { LineResult, LineV2 } from "./score";

export type TracePart = {
  key: string;
  label: string;
  raw: unknown;
  normalised: number;
  weight: number;
  contribution: number;
  missing: boolean;
  source?: { label: string; url?: string; capturedAt?: string };
  note?: string;
};

export type EngineTrace = {
  engine: "v1" | "v2";
  rulesVersion: string;
  computedAt: string;
  orgId: string;
  lineKey: string;
  line: { name: string; value: number; materiality: number; band: string; ruleId: string; ruleVersion: number };
  weights: Record<string, number>;
  candidates: {
    appId: string;
    name: string;
    rank: number;
    match: number;
    inUse: boolean;
    kind: "add" | "change" | null;
    parts: TracePart[];
    formula: string;
  }[];
  excluded: { appId: string; name: string; reason: string }[];
  warnings: string[];
};

/** A short fingerprint of the weights + rule inputs in use, so a trace says which rules produced it. */
export function rulesVersion(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The flat weights a trace shows: the tree of scoring_v2, dotted. */
export function flatWeights(s: ScoringV2): Record<string, number> {
  return {
    strength: s.weights.strength,
    fit: s.weights.fit,
    quality: s.weights.quality,
    price: s.weights.price,
    "fit.integration_fit": s.fit.integration_fit,
    "fit.job_fit": s.fit.job_fit,
    "job_fit.category_match": s.job_fit.category_match,
    "job_fit.function_match": s.job_fit.function_match,
    "job_fit.keyword_match": s.job_fit.keyword_match,
    "quality.rating_score": s.quality.rating_score,
    "quality.volume_score": s.quality.volume_score,
  };
}

type Deep<T> = { [K in keyof T]?: T[K] extends object ? Deep<T[K]> : T[K] };

/** What-if (dev only, never saved): the YAML weights with overrides on top, validated. */
export function withOverrides(base: ScoringV2, over: Deep<ScoringV2> | null | undefined): ScoringV2 {
  if (!over) return base;
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? merge(a[k] as Record<string, unknown>, v as Record<string, unknown>) : v;
    return out;
  };
  return ScoringV2.parse(merge(base as unknown as Record<string, unknown>, over as Record<string, unknown>));
}

export function v2Trace(meta: { orgId: string; computedAt: string; scoring: ScoringV2; rulesVersion: string }, line: LineV2, res: LineResult, limit = 25): EngineTrace {
  return {
    engine: "v2",
    rulesVersion: meta.rulesVersion,
    computedAt: meta.computedAt,
    orgId: meta.orgId,
    lineKey: line.lineKey,
    line: { name: line.name, value: line.value, materiality: line.materiality, band: line.band, ruleId: line.ruleId, ruleVersion: line.ruleVersion },
    weights: flatWeights(meta.scoring),
    candidates: [...res.candidates.slice(0, limit), ...res.candidates.slice(limit).filter((c) => c.inUse)].map((c) => ({
      appId: c.appId,
      name: c.name,
      rank: c.rank,
      match: c.match,
      inUse: c.inUse,
      kind: c.kind,
      parts: c.parts,
      formula: c.formula,
    })),
    excluded: res.excluded,
    warnings: [...res.warnings, ...(res.candidates.length > limit ? [`Showing the top ${limit} of ${res.candidates.length} candidates`] : [])],
  };
}

type V1Rec = { appId: string; name: string; rank: number; match: number; inUse: boolean; kind: "add" | "change" | null; components: Record<string, number> };

/** v1's stored shortlist as a trace (v1 keeps only its four components). */
export function v1Trace(meta: { orgId: string; computedAt: string; scoring: Scoring }, line: LineV2, recs: V1Rec[]): EngineTrace {
  const w = meta.scoring.weights;
  const map: [string, string, number][] = [
    ["strength_norm", "Strength", w.strength],
    ["fit_with_in_use", "Fit with apps kept", w.fit_with_in_use],
    ["peer_results", "Peer results", w.peer_results],
    ["price_fit", "Price fit", w.price_fit],
  ];
  return {
    engine: "v1",
    rulesVersion: rulesVersion(meta.scoring),
    computedAt: meta.computedAt,
    orgId: meta.orgId,
    lineKey: line.lineKey,
    line: { name: line.name, value: line.value, materiality: line.materiality, band: line.band, ruleId: line.ruleId, ruleVersion: line.ruleVersion },
    weights: { strength: w.strength, fit_with_in_use: w.fit_with_in_use, peer_results: w.peer_results, price_fit: w.price_fit },
    candidates: recs.map((r) => {
      const parts = map.map(([k, label, weight]) => {
        const n = r.components[k] ?? meta.scoring.neutral;
        return { key: k, label, raw: n, normalised: n, weight, contribution: Math.round(100 * weight * n * 10_000) / 10_000, missing: r.components[k] === undefined };
      });
      return {
        appId: r.appId,
        name: r.name,
        rank: r.rank,
        match: r.match,
        inUse: r.inUse,
        kind: r.kind,
        parts,
        formula: `100 × (${map.map(([k, , wt]) => `${wt.toFixed(2)}×${(r.components[k] ?? meta.scoring.neutral).toFixed(2)}`).join(" + ")}) = ${r.match}`,
      };
    }),
    excluded: [],
    warnings: ["v1 stores its shortlist only (top 3 + the app in use)"],
  };
}
