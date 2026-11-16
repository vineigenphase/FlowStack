/** Round-2 3c: one-off detection from the monthly P&L. */
import { describe, expect, it } from "vitest";
import { lowerBand, oneOffs } from "@/lib/signals/one-off";

const months = ["2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31"];
const rule = { concentration: 0.6, min_months: 3 };
const line = (vals: number[]) => new Map(months.map((m, i) => [m, vals[i] ?? 0]));

describe("one-off detection", () => {
  it("a spike: one month holds ≥ 60% of the year to date → flagged as a likely one-off, with the month", () => {
    const r = oneOffs(months, new Map([["pl:463", line([200, 200, 24_000, 200, 200, 200, 200])]]), rule);
    expect(r.get("pl:463")).toEqual({ month: "2026-06-30", share: 0.952, note: "Most of this year's total is in one month (Jun 2026). It may be a one-off." });
  });
  it("a steady line is not", () => {
    expect(oneOffs(months, new Map([["pl:477", line([14_000, 14_200, 13_900, 14_100, 14_000, 14_300, 14_050])]]), rule).size).toBe(0);
  });
  it("needs at least 3 months; refunds in other months don't hide a spike", () => {
    expect(oneOffs(months.slice(0, 2), new Map([["pl:1", new Map([["2026-04-30", 100], ["2026-05-31", 9_000]])]]), rule).size).toBe(0);
    // 10,000 spend in June, then a 2,000 refund: June is 125% of the net year to date.
    expect(oneOffs(months, new Map([["pl:2", line([0, 0, 10_000, -2_000, 0, 0, 0])]]), rule).get("pl:2")?.month).toBe("2026-06-30");
  });
  it("drops one band (low stays low)", () => {
    expect([lowerBand("high"), lowerBand("medium"), lowerBand("low")]).toEqual(["medium", "low", "low"]);
  });
});

describe("in the flag computation", () => {
  it("a one-off line drops a band and carries the note in its evidence", async () => {
    const { computeFlags } = await import("@/lib/signals/compute");
    const { rulesFile, apps } = await import("@/lib/catalog/load");
    const ctx = {
      revenue: 100_000, totalAssets: 100_000, monthsInPeriod: 7, cfReconciled: true, rules: rulesFile().rules, apps: apps(), markets: ["UK"],
      inUse: new Map(), prices: new Map(), overrides: new Map(), tb: new Map(), bands: { high: 0.1, medium: 0.02 }, scoring: rulesFile().scoring,
      oneOff: new Map([["pl:463", { month: "2026-06-30", share: 0.95, note: "Most of this year's total is in one month (Jun 2026). It may be a one-off." }]]),
    };
    const lines = [
      { kind: "pl" as const, lineKey: "pl:463", xeroAccountId: null, code: "463", name: "Software", category: "software_subscriptions", value: 25_000 },
      { kind: "pl" as const, lineKey: "pl:464", xeroAccountId: null, code: "464", name: "Travel", category: "travel", value: 25_000 },
    ];
    const out = computeFlags(lines, ctx);
    const one = out.find((f) => f.lineKey === "pl:463")!;
    const steady = out.find((f) => f.lineKey === "pl:464")!;
    expect(steady.band).toBe("high");
    expect(one.band).toBe("medium");
    expect((one.evidence as { one_off?: { month: string } }).one_off?.month).toBe("2026-06-30");
  });
});
