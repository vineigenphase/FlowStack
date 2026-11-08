/**
 * Headline ratios from the P&L (BACKEND.md §18, 2.0 KPIs): gross margin, labour cost share, net income share.
 * Pure. Built only from mapped account categories; a ratio is null when its parts aren't in the figures, never guessed.
 */
export const LABOUR_CATEGORIES = ["wages", "employer_ni", "pensions", "staff_other"] as const;

export type Kpis = {
  revenue: number;
  grossMargin: number | null;
  labourShare: number | null;
  netShare: number | null;
  parts: { costOfSales: number | null; labour: number | null; netProfit: number | null };
};

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function kpis(lines: { category: string | null; value: number }[], totals: Record<string, number>): Kpis {
  const revenue = totals.revenue ?? 0;
  const sum = (cats: readonly string[]) => {
    const hit = lines.filter((l) => l.category && cats.includes(l.category));
    return hit.length ? hit.reduce((s, l) => s + Math.abs(l.value), 0) : null;
  };
  const costOfSales = sum(["cost_of_sales"]);
  const labour = sum(LABOUR_CATEGORIES);
  const netProfit = typeof totals.net_profit === "number" ? totals.net_profit : null;
  const ok = revenue > 0;
  return {
    revenue,
    grossMargin: ok && costOfSales !== null ? r4((revenue - costOfSales) / revenue) : null,
    labourShare: ok && labour !== null ? r4(labour / revenue) : null,
    netShare: ok && netProfit !== null ? r4(netProfit / revenue) : null,
    parts: { costOfSales, labour, netProfit },
  };
}
