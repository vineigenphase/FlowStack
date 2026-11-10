/** Reporting dates (BACKEND.md §3.4). All dates are UTC calendar dates as YYYY-MM-DD. */

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Last day of the previous calendar month; today's month end if `includeCurrentMonth`. */
export function latestMonthEnd(now: Date, includeCurrentMonth = false): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (includeCurrentMonth) return ymd(y, m, lastDay(y, m));
  return ymd(y, m, 0);
}

/** The financial year containing `asAt` → { start, priorEnd } for an FY ending fyEndDay/fyEndMonth (1-12). */
export function financialYear(asAt: string, fyEndMonth: number, fyEndDay: number) {
  const d = new Date(asAt + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const m0 = fyEndMonth - 1;
  const day = (yy: number) => Math.min(fyEndDay, lastDay(yy, m0));
  // Most recent FY end strictly before asAt.
  let endY = y;
  if (ymd(endY, m0, day(endY)) >= asAt) endY -= 1;
  const priorEnd = ymd(endY, m0, day(endY));
  const start = new Date(Date.UTC(endY, m0, day(endY) + 1)).toISOString().slice(0, 10);
  return { start, priorEnd };
}

export function periodsFor(now: Date, org: { fyEndMonth: number; fyEndDay: number; includeCurrentMonth?: boolean }) {
  const to = latestMonthEnd(now, org.includeCurrentMonth);
  const { start, priorEnd } = financialYear(to, org.fyEndMonth, org.fyEndDay);
  return { from: start, to, priorFyEnd: priorEnd };
}

export function monthsBack(asAt: string, n: number): string {
  const d = new Date(asAt + "T00:00:00Z");
  return ymd(d.getUTCFullYear(), d.getUTCMonth() - n + 1, 1);
}

/** v1.1 B: the month end `i` months before `asAt`'s month (i = 0 → that month's end). */
export function monthEndBack(asAt: string, i: number): string {
  const d = new Date(asAt + "T00:00:00Z");
  return ymd(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 0);
}

/** First day of `asAt`'s month. */
export function monthStart(asAt: string): string {
  const d = new Date(asAt + "T00:00:00Z");
  return ymd(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** How many month ends `date` is before `asAt` (0 = same month), or null if it isn't a month end in range. */
export function monthIndex(asAt: string, date: string, max = 11): number | null {
  for (let i = 0; i <= max; i++) if (monthEndBack(asAt, i) === date) return i;
  return null;
}
