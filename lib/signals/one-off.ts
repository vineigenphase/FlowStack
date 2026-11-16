/**
 * One-off detection from the monthly P&L (round-2 3c, 10 Nov 2026). Pure.
 * With at least `min_months` months of this financial year, a line where one month holds ≥ `concentration` of the
 * year-to-date value is probably a one-off (a year's software paid up front, a single big purchase): its flag drops
 * one band and says so. Thresholds live in rules.yaml → one_off.
 */
export type OneOffRule = { concentration: number; min_months: number };
export type OneOff = { month: string; share: number; note: string };

const MONTH = (end: string) => new Date(end + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * `months`: this financial year's month ends (oldest first) that have a monthly P&L; `values`: per line key, the
 * month end → value (a line missing from a month's report was zero that month).
 */
export function oneOffs(months: string[], values: Map<string, Map<string, number>>, rule: OneOffRule): Map<string, OneOff> {
  const out = new Map<string, OneOff>();
  if (months.length < rule.min_months) return out;
  for (const [key, byMonth] of values) {
    const series = months.map((m) => byMonth.get(m) ?? 0);
    const total = series.reduce((a, b) => a + b, 0);
    if (Math.abs(total) < 0.005) continue;
    const sign = Math.sign(total);
    let top = 0;
    let at = 0;
    series.forEach((v, i) => {
      if (v * sign > top) {
        top = v * sign;
        at = i;
      }
    });
    const share = top / Math.abs(total);
    if (share >= rule.concentration) {
      const month = months[at]!;
      out.set(key, { month, share: Math.round(share * 1000) / 1000, note: `Most of this year's total is in one month (${MONTH(month)}). It may be a one-off.` });
    }
  }
  return out;
}

export const lowerBand = (b: "high" | "medium" | "low"): "high" | "medium" | "low" => (b === "high" ? "medium" : "low");
