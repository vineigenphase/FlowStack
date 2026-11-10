/**
 * Trend signals (BACKEND.md §7.3, v1.1 B). Pure. Movement tells the story: debtor days rising from 38 to 52 is
 * worth a chasing app even when the level alone wouldn't be.
 *
 *   debtor_days          = trade debtors ÷ (revenue last 3m × 4) × 365
 *   creditor_days        = trade creditors ÷ ((cost of sales + overheads) last 3m × 4) × 365
 *   stock_days           = inventory ÷ (cost of sales last 3m × 4) × 365
 *   cash_headroom_months = bank ÷ average monthly net cash outflow (last 3m)
 *
 * Fires when the latest value is past the threshold (above for days, below for headroom) AND it moved the wrong
 * way by at least min_change over 3 months. The £ value is the extra balance tied up by the rise:
 * (days now − days 3 months ago) ÷ 365 × the annualised base. For headroom it is the cash needed to get back to
 * the threshold: (threshold − headroom) × monthly outflow. Nothing is estimated: a series with a missing month or
 * a zero base gives no value for that month.
 */

/** One month, newest first: balances by account category (BS) and that month's P&L totals. */
export type Month = { end: string; bs: Record<string, number>; revenue: number; costOfSales: number; overheads: number };
export type TrendKey = "debtor_days" | "creditor_days" | "stock_days" | "cash_headroom_months";
export type TrendRule = { threshold: number; min_change: number };

export type Trend = {
  key: TrendKey;
  series: { end: string; value: number | null }[]; // newest first
  latest: number | null;
  threeMonthsAgo: number | null;
  change: number | null;
  fires: boolean;
  /** £ tied up by the move (0 when it doesn't fire). */
  value: number;
  /** The balance the trend is about (category), for the trial balance evidence. */
  balanceCategory: string;
  formula: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const sum3 = (ms: Month[], i: number, f: (m: Month) => number) => (ms.length >= i + 3 ? ms.slice(i, i + 3).reduce((s, m) => s + f(m), 0) : null);

function daysSeries(ms: Month[], balance: (m: Month) => number, base: (m: Month) => number) {
  return ms.map((m, i) => {
    const b3 = sum3(ms, i, base);
    return { end: m.end, value: b3 && b3 > 0 ? r1((balance(m) / (b3 * 4)) * 365) : null };
  });
}

export function computeTrends(months: Month[], rules: Partial<Record<TrendKey, TrendRule>>): Trend[] {
  const out: Trend[] = [];
  const days = (key: TrendKey, cat: string, base: (m: Month) => number, baseLabel: string) => {
    const rule = rules[key];
    if (!rule) return;
    const series = daysSeries(months, (m) => m.bs[cat] ?? 0, base);
    const latest = series[0]?.value ?? null;
    const before = series[3]?.value ?? null;
    const change = latest !== null && before !== null ? r1(latest - before) : null;
    const fires = latest !== null && change !== null && latest > rule.threshold && change >= rule.min_change;
    const annualBase = (sum3(months, 0, base) ?? 0) * 4;
    out.push({
      key,
      series,
      latest,
      threeMonthsAgo: before,
      change,
      fires,
      value: fires ? r2((change! / 365) * annualBase) : 0,
      balanceCategory: cat,
      formula: `${cat.replace(/_/g, " ")} ÷ (${baseLabel} last 3 months × 4) × 365`,
    });
  };
  days("debtor_days", "trade_debtors", (m) => m.revenue, "revenue");
  days("creditor_days", "trade_creditors", (m) => m.costOfSales + m.overheads, "cost of sales + overheads");
  days("stock_days", "inventory", (m) => m.costOfSales, "cost of sales");

  const hr = rules.cash_headroom_months;
  if (hr) {
    const bank = (m: Month) => m.bs.bank ?? 0;
    const series = months.map((m, i) => {
      if (months.length < i + 4) return { end: m.end, value: null };
      const outflow = (bank(months[i + 3]!) - bank(m)) / 3; // average monthly fall in cash
      return { end: m.end, value: outflow > 0 ? r1(bank(m) / outflow) : null };
    });
    const latest = series[0]?.value ?? null;
    const before = series[3]?.value ?? null;
    const change = latest !== null && before !== null ? r1(latest - before) : null;
    // Headroom falling: the wrong way is down, and a business burning no cash has no headroom problem.
    const fires = latest !== null && latest < hr.threshold && (before === null ? false : before - latest >= hr.min_change);
    const outflow = months.length >= 4 ? (bank(months[3]!) - bank(months[0]!)) / 3 : 0;
    out.push({
      key: "cash_headroom_months",
      series,
      latest,
      threeMonthsAgo: before,
      change,
      fires,
      value: fires ? r2((hr.threshold - latest!) * outflow) : 0,
      balanceCategory: "bank",
      formula: "bank ÷ average monthly fall in cash over the last 3 months",
    });
  }
  return out;
}
