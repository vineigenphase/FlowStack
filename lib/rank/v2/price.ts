/**
 * ENGINE-V2 §1.2 price: annual cost in £ (prices converted to £, owner 23 Nov 2026) as a share of annual revenue.
 * 1 at or below price_share_good, falling linearly to 0 at price_share_bad.
 *
 * Which tier: the cheapest paid tier whose cost can be worked out for this business (per business; per user or per
 * employee only when headcount is known), else a free plan. Usage-priced, "other" and unpriced tiers can't be costed.
 * The listings don't say which tier a business of this size needs, so the cheapest is used and the trace says so.
 * Quote-only, no tiers, or no revenue → missing.
 */
import type { ScoringV2 } from "@/lib/catalog/load";
import type { V2App } from "./apps";
import { clamp01, missingInput, type Input } from "./part";

const PER_YEAR = { month: 12, year: 1, one_off: 1 } as const;

export function priceScore(app: V2App, annualRevenue: number, headcount: number | null, s: ScoringV2): Input {
  const tiers = app.listing?.pricing_tiers ?? [];
  if (!tiers.length) return missingInput(s.neutral, "Price not published");
  if (!(annualRevenue > 0)) return missingInput(s.neutral, "No revenue to compare the price with");
  const costed = tiers
    .filter((t) => t.price_gbp !== null)
    .map((t) => {
      const per = PER_YEAR[t.period];
      if (t.unit === "org") return { t, annual: t.price_gbp! * per };
      if ((t.unit === "user" || t.unit === "employee") && headcount) return { t, annual: t.price_gbp! * per * headcount };
      return null;
    })
    .filter((x): x is { t: (typeof tiers)[number]; annual: number } => x !== null);
  if (!costed.length) return missingInput(s.neutral, tiers.some((t) => t.price_gbp !== null) ? "Priced per user or by usage; headcount or volumes unknown" : "Price on request");
  const paid = costed.filter((c) => c.annual > 0).sort((a, b) => a.annual - b.annual);
  const pick = paid[0] ?? costed[0]!;
  const share = pick.annual / annualRevenue;
  const { price_share_good: good, price_share_bad: bad } = s.price;
  const score = share <= good ? 1 : share >= bad ? 0 : 1 - (share - good) / (bad - good);
  const orig = pick.t.original ? ` (${pick.t.original.currency} ${pick.t.original.amount}, converted)` : "";
  return {
    raw: { tier: pick.t.name, annual_gbp: Math.round(pick.annual), share_of_revenue: Math.round(share * 100_000) / 100_000 },
    normalised: clamp01(score),
    missing: false,
    note: `${pick.t.name}: about £${Math.round(pick.annual).toLocaleString("en-GB")} a year${orig}, ${(share * 100).toFixed(2)}% of revenue (cheapest plan we can cost)`,
    source: { label: "Vendor pricing page (workbook, 17 Nov 2026)" },
  };
}
