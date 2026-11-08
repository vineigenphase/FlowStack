/** BACKEND.md §18 KPIs: gross margin, labour share, net income share. Missing parts → null, never guessed. */
import { describe, expect, it } from "vitest";
import { kpis } from "@/lib/statements/kpis";

describe("kpis", () => {
  it("matches the sample P&L (Copperpot fixture figures)", () => {
    const k = kpis(
      [
        { category: "sales", value: 2_554_000 },
        { category: "cost_of_sales", value: 812_300 },
        { category: "wages", value: 690_000 },
        { category: "employer_ni", value: 71_200 },
        { category: "pensions", value: 20_700 },
        { category: "contractors", value: 50_000 },
      ],
      { revenue: 2_566_400, net_profit: 437_600 },
    );
    expect(k.grossMargin).toBe(0.6835);
    expect(k.labourShare).toBe(0.3047); // contractors excluded
    expect(k.netShare).toBe(0.1705);
  });

  it("returns null for a ratio whose accounts aren't there, and for no revenue", () => {
    const k = kpis([{ category: "rent", value: 10 }], { revenue: 1000, net_profit: -50 });
    expect(k).toMatchObject({ grossMargin: null, labourShare: null, netShare: -0.05 });
    expect(kpis([], { revenue: 0, net_profit: 0 })).toMatchObject({ grossMargin: null, labourShare: null, netShare: null });
  });
});
