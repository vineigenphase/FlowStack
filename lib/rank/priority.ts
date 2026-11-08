/**
 * Priority presets (CLAUDE.md §7.3b, BACKEND.md §8.3 "come later"). Pure.
 *
 *   score = w.fit × fit + w.cost × cost + w.speed × speed + w.support × support
 *
 * - fit:     the line's normal match (§8.3) ÷ 100
 * - cost:    published "from" price, cheapest of the candidates = 1, others cheapest ÷ price
 * - speed:   published days to go live, fastest = 1, others fastest ÷ days
 * - support: support-after-go-live from verified reviews (90-day re-rate first), (avg − 1) ÷ 4, needs 3+ reviews
 * Anything unknown is neutral (0.5) and the reason says so: a missing fact is never estimated.
 */
export const PRIORITIES = {
  balanced: { label: "Balanced", w: { fit: 0.4, cost: 0.2, speed: 0.2, support: 0.2 } },
  cost: { label: "Lowest cost", w: { fit: 0.3, cost: 0.5, speed: 0.1, support: 0.1 } },
  speed: { label: "Fastest live", w: { fit: 0.3, cost: 0.1, speed: 0.5, support: 0.1 } },
  support: { label: "Best support", w: { fit: 0.3, cost: 0.1, speed: 0.1, support: 0.5 } },
} as const;
export type Priority = keyof typeof PRIORITIES;
export const isPriority = (p: unknown): p is Priority => typeof p === "string" && p in PRIORITIES;

export type PriorityInput = { appId: string; name: string; match: number; priceFrom: number | null; daysToLive: number | null; support: { avg: number; n: number } | null };
export type PriorityRanked = PriorityInput & { score: number; parts: { fit: number; cost: number; speed: number; support: number }; why: string };

const NEUTRAL = 0.5;
export const MIN_SUPPORT_REVIEWS = 3;
const gbp = (n: number) => (n === 0 ? "free plan" : `from £${n % 1 ? n.toFixed(2) : n} a month`);

export function rankByPriority(cands: PriorityInput[], priority: Priority): PriorityRanked[] {
  const w = PRIORITIES[priority].w;
  const prices = cands.map((c) => c.priceFrom).filter((p): p is number => p !== null);
  const days = cands.map((c) => c.daysToLive).filter((d): d is number => d !== null && d > 0);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const minDays = days.length ? Math.min(...days) : null;

  const out = cands.map((c): PriorityRanked => {
    const fit = Math.max(0, Math.min(1, c.match / 100));
    const cost = c.priceFrom === null || minPrice === null ? NEUTRAL : c.priceFrom === 0 ? 1 : minPrice === 0 ? 0.2 : minPrice / c.priceFrom;
    const speed = c.daysToLive === null || !minDays || c.daysToLive <= 0 ? NEUTRAL : minDays / c.daysToLive;
    const sup = c.support && c.support.n >= MIN_SUPPORT_REVIEWS ? (c.support.avg - 1) / 4 : NEUTRAL;
    const score = Math.round(100 * (w.fit * fit + w.cost * cost + w.speed * speed + w.support * sup) * 10) / 10;

    const why: string[] = [];
    if (priority === "cost" || priority === "balanced") {
      why.push(c.priceFrom === null ? "Price not published · we're checking" : c.priceFrom === minPrice ? `Cheapest published price here (${gbp(c.priceFrom)})` : `Published price ${gbp(c.priceFrom)}`);
    }
    if (priority === "speed" || priority === "balanced") {
      why.push(c.daysToLive === null ? "Time to go live not published" : `About ${c.daysToLive} days to go live${c.daysToLive === minDays ? ", the fastest here" : ""}`);
    }
    if (priority === "support" || priority === "balanced") {
      why.push(c.support && c.support.n >= MIN_SUPPORT_REVIEWS ? `Support after go-live ${c.support.avg}/5 from ${c.support.n} verified reviews` : "Not enough verified reviews yet to judge support");
    }
    return { ...c, score, parts: { fit, cost, speed, support: sup }, why: why.join(". ") };
  });
  return out.sort((a, b) => b.score - a.score || b.match - a.match || a.name.localeCompare(b.name));
}
