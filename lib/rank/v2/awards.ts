/**
 * ENGINE-V2 §1.2 award_boost: sum of level_boost × 0.5^(years since award / half-life), winner 0.10, finalist 0.05,
 * counting only awards in the business's region or global (region-unknown awards are stored as global, owner
 * 23 Nov 2026); capped. No awards → 0 (not missing). Never changes the raw rating.
 */
import type { ScoringV2 } from "@/lib/catalog/load";
import type { V2App } from "./apps";
import type { Input } from "./part";

/** Our markets → the region names Xero's awards use. */
const REGION: Record<string, string[]> = { UK: ["UK"], US: ["US"], CA: ["US", "CA"], AU: ["ANZ", "AU"] };

export function awardBoost(app: V2App, markets: string[], year: number, s: ScoringV2): Input {
  const awards = app.listing?.awards ?? [];
  const regions = new Set(["global", ...markets.flatMap((m) => REGION[m] ?? [m])]);
  const counted = awards.filter((a) => regions.has(a.region));
  const a = s.award_boost;
  const sum = counted.reduce((t, w) => t + (w.level === "winner" ? a.winner : a.finalist) * Math.pow(0.5, Math.max(0, year - w.year) / a.half_life_years), 0);
  const boost = Math.min(a.cap, sum);
  return {
    raw: counted.map((w) => `${w.name} ${w.year} ${w.level} (${w.region})`),
    normalised: Math.round(boost * 10_000) / 10_000,
    missing: false,
    note: counted.length ? `${counted.length} Xero award${counted.length > 1 ? "s" : ""}${sum > a.cap ? ", capped" : ""}` : "No Xero awards",
    source: counted.length ? { label: "Xero award-winning apps collection" } : undefined,
  };
}
