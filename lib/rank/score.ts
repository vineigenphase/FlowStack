/**
 * Scoring (BACKEND.md §8.3). Pure.
 *   match = 100 × (0.40 strength_norm + 0.25 fit_with_in_use + 0.20 peer_results + 0.15 price_fit)
 * Missing price → price_fit is neutral (0.5), never estimated. Peer results are neutral until 3.0.
 */
import type { App, Scoring } from "@/lib/catalog/load";

export type InUse = { appId: string; spend12m: number; monthsSeen: number };
export type PriceInfo = { known: boolean };

export type Components = { strength_norm: number; fit_with_in_use: number; peer_results: number; price_fit: number };
export type Scored = { appId: string; name: string; match: number; components: Components; inUse: boolean; reason: string };

/** Apps that never count as "an app they keep" for fit purposes. */
const NOT_KEPT = new Set(["accounting", "other_software"]);

export function edgeKind(a: App, b: App): "native" | "via_app" | "csv" | null {
  const kinds = [...a.integrations.filter((i) => i.to === b.id), ...b.integrations.filter((i) => i.to === a.id)].map((i) => i.kind);
  if (kinds.includes("native")) return "native";
  if (kinds.includes("via_app")) return "via_app";
  if (kinds.includes("csv")) return "csv";
  return null;
}

export function fitWithInUse(app: App, kept: App[], s: Scoring): { score: number; with: App | null; kind: string } {
  const others = kept.filter((k) => k.id !== app.id && !k.categories.some((c) => NOT_KEPT.has(c)));
  if (!others.length) return { score: s.fit.no_apps, with: null, kind: "no_apps" };
  let best = { score: s.fit.none, with: null as App | null, kind: "none" };
  for (const k of others) {
    const e = edgeKind(app, k);
    if (!e) continue;
    const score = s.fit[e];
    if (score > best.score) best = { score, with: k, kind: e };
  }
  return best;
}

export function priceFit(app: App, price: PriceInfo | undefined, annualRevenue: number, s: Scoring): number {
  if (!price?.known || !app.revenue_band) return s.neutral;
  const { min, max } = app.revenue_band;
  return annualRevenue >= min && (max === null || annualRevenue <= max) ? 1 : 0.2;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function scoreCandidates(opts: {
  candidates: App[];
  strengthNorm: number;
  kept: App[];
  inUse: Map<string, InUse>;
  prices: Map<string, PriceInfo>;
  annualRevenue: number;
  scoring: Scoring;
}): Scored[] {
  const { scoring: s } = opts;
  const w = s.weights;
  const out = opts.candidates.map((app): Scored => {
    const fit = fitWithInUse(app, opts.kept, s);
    const price = priceFit(app, opts.prices.get(app.id), opts.annualRevenue, s);
    const components: Components = {
      strength_norm: opts.strengthNorm,
      fit_with_in_use: fit.score,
      peer_results: s.neutral,
      price_fit: price,
    };
    const match = r1(
      100 * (w.strength * components.strength_norm + w.fit_with_in_use * components.fit_with_in_use + w.peer_results * components.peer_results + w.price_fit * components.price_fit),
    );
    const used = opts.inUse.get(app.id);
    const parts: string[] = [];
    if (used) parts.push(`You already pay for it (£${Math.round(used.spend12m).toLocaleString("en-GB")} over ${used.monthsSeen} months)`);
    if (fit.with) parts.push(`${fit.kind === "native" ? "Works directly with" : fit.kind === "via_app" ? "Connects via another app to" : "CSV import from"} ${fit.with.name}, which you keep`);
    else if (fit.kind === "none") parts.push("No integration with the apps you keep");
    if (!opts.prices.get(app.id)?.known) parts.push("Price not published · we're checking");
    return { appId: app.id, name: app.name, match, components, inUse: Boolean(used), reason: parts.join(". ") || "Fits this category" };
  });
  return out.sort((a, b) => b.match - a.match || Number(b.inUse) - Number(a.inUse) || a.name.localeCompare(b.name));
}

/** Top 3, plus the in-use app if it isn't already there (BACKEND.md §8.3). */
export function shortlistOf(scored: Scored[]): Scored[] {
  const top = scored.slice(0, 3);
  for (const s of scored.slice(3)) if (s.inUse) top.push(s);
  return top;
}
