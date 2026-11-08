/** CLAUDE.md §7.3b priority presets: weights per priority, missing facts neutral (never estimated). */
import { describe, expect, it } from "vitest";
import { PRIORITIES, rankByPriority, type PriorityInput } from "@/lib/rank/priority";

const a: PriorityInput = { appId: "a", name: "Alpha", match: 80, priceFrom: 100, daysToLive: 30, support: { avg: 3, n: 5 } };
const b: PriorityInput = { appId: "b", name: "Bravo", match: 70, priceFrom: 25, daysToLive: 60, support: { avg: 4.8, n: 2 } };
const c: PriorityInput = { appId: "c", name: "Charlie", match: 60, priceFrom: null, daysToLive: 5, support: { avg: 5, n: 9 } };

describe("priority presets", () => {
  it("weights add up to 1 and follow the spec table", () => {
    for (const p of Object.values(PRIORITIES)) expect(Object.values(p.w).reduce((s, x) => s + x, 0)).toBeCloseTo(1);
    expect(PRIORITIES.cost.w).toEqual({ fit: 0.3, cost: 0.5, speed: 0.1, support: 0.1 });
  });

  it("lowest cost puts the cheapest published price first", () => {
    const r = rankByPriority([a, b, c], "cost");
    expect(r[0]!.appId).toBe("b");
    expect(r[0]!.why).toContain("Cheapest published price here (from £25 a month)");
    // Missing price is neutral, and says so.
    expect(r.find((x) => x.appId === "c")!.parts.cost).toBe(0.5);
    expect(r.find((x) => x.appId === "c")!.why).toContain("Price not published");
  });

  it("fastest live and best support reorder; under 3 reviews support is neutral", () => {
    expect(rankByPriority([a, b, c], "speed")[0]!.appId).toBe("c");
    const s = rankByPriority([a, b, c], "support");
    expect(s[0]!.appId).toBe("c");
    expect(s.find((x) => x.appId === "b")!.parts.support).toBe(0.5);
    expect(s.find((x) => x.appId === "b")!.why).toContain("Not enough verified reviews");
  });

  it("with nothing published, every priority falls back to the standard match order", () => {
    const bare = [a, b, c].map((x) => ({ ...x, priceFrom: null, daysToLive: null, support: null }));
    for (const p of Object.keys(PRIORITIES) as (keyof typeof PRIORITIES)[]) expect(rankByPriority(bare, p).map((x) => x.appId)).toEqual(["a", "b", "c"]);
  });
});
