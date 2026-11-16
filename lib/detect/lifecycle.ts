/**
 * App lifecycle (BACKEND.md §6.1, v1.1 C; rule DECIDED in round 2, 10 Nov 2026). Pure. What happens when an app's
 * payments stop: we neither wait silently for months nor guess. Months are calendar months ("YYYY-MM-01").
 *
 *   cycle     from the median gap between paid months: 1 → monthly, 3 → quarterly, 11–13 → annual, else unknown
 *   new       first payment in the last 60 days (this month or last)
 *   active    the next payment isn't missed yet
 *   lapsing   one expected payment missed            → ask in the app: "Do you still use it?" (still counts as cover)
 *   inactive  a second expected payment missed with no answer, or the user said they stopped
 *   declared  the user says they use it but we can't see payments (re-asked after 6 months)
 *
 * "Missed" (round-2 3a): expected = last payment DATE + cycle; missed only when BOTH today ≥ expected + leeway
 * (rules.yaml lifecycle.leeway_days, 7) AND books_through ≥ expected + leeway, so books entered late never look like
 * a cancelled app. Rows without dates (before the dates were recorded) fall back to the month rule: missed from the
 * month end after the expected month.
 *
 * new, active, lapsing and declared count as coverage; inactive does not. So one missed payment never produces a
 * "you have no app" flag.
 */
export type Cycle = "monthly" | "quarterly" | "annual" | "unknown";
export type AppState = "new" | "active" | "lapsing" | "inactive" | "declared";
export type StatusAnswer = { answer: "still_use" | "moved" | "stopped" | "replacing" | "both" | "declared"; at: string; replacedBy?: string | null };

export const COUNTS_AS_COVERAGE: ReadonlySet<AppState> = new Set(["new", "active", "lapsing", "declared"]);
export const DECLARED_FOR_MONTHS = 6;
export const LAPSING_QUEUE_DAYS = 30;

const ym = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return y! * 12 + (m! - 1);
};
const monthEnd = (n: number) => new Date(Date.UTC(Math.floor(n / 12), (n % 12) + 1, 0)).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

export function cycleOf(paidMonths: string[]): { cycle: Cycle; months: number | null } {
  const ms = [...new Set(paidMonths.map(ym))].sort((a, b) => a - b);
  if (ms.length < 2) return { cycle: "unknown", months: null };
  const gaps = ms.slice(1).map((m, i) => m - ms[i]!).sort((a, b) => a - b);
  const g = gaps[Math.floor((gaps.length - 1) / 2)]!;
  if (g === 1) return { cycle: "monthly", months: 1 };
  if (g === 3) return { cycle: "quarterly", months: 3 };
  if (g >= 11 && g <= 13) return { cycle: "annual", months: 12 };
  return { cycle: "unknown", months: g };
}

export type Lifecycle = {
  cycle: Cycle;
  state: AppState;
  /** End of the month the next payment was due in (null when we can't tell). */
  nextExpected: string | null;
  /** The date it became lapsing (next expected + 15 days), when lapsing. */
  lapsingSince: string | null;
  /** Show the "Do you still use it?" question. */
  ask: boolean;
};

/** Day-level facts for the round-2 rule; without them the month rule applies. */
export type LifecycleDays = { lastPaid?: string | null; booksThrough?: string | null; today?: string; leewayDays?: number };

/** The same day of the month `n` months later, clamped to that month's end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const target = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day!, last))).toISOString().slice(0, 10);
}

/** Missed: both today and the books are past expected + leeway (ISO dates compare as strings). */
export const missed = (expected: string, today: string, booksThrough: string, leeway: number) => {
  const due = addDays(expected, leeway);
  return today >= due && booksThrough >= due;
};

export function lifecycleOf(paidMonths: string[], asAt: string, answer?: StatusAnswer | null, days: LifecycleDays = {}): Lifecycle {
  const now = ym(asAt);
  const ms = [...new Set(paidMonths.map(ym))].sort((a, b) => a - b);
  const { cycle, months: c } = cycleOf(paidMonths);
  const last = ms.at(-1);
  const first = ms[0];
  const answeredMonth = answer ? ym(answer.at) : null;
  // Payments after the answer win: the ledger has moved on.
  const answerHolds = answer && (last === undefined || answeredMonth! >= last);

  if (answerHolds && (answer.answer === "stopped" || answer.answer === "moved" || answer.answer === "replacing")) {
    return { cycle, state: "inactive", nextExpected: null, lapsingSince: null, ask: false };
  }
  const declaredActive = answerHolds && (answer.answer === "still_use" || answer.answer === "declared") && now - answeredMonth! < DECLARED_FOR_MONTHS;
  if (declaredActive) return { cycle, state: "declared", nextExpected: null, lapsingSince: null, ask: false };
  if (last === undefined) return { cycle, state: "inactive", nextExpected: null, lapsingSince: null, ask: false };

  if (first !== undefined && now - first <= 1 && ms.length <= 2) return { cycle, state: "new", nextExpected: c ? monthEnd(last + c) : null, lapsingSince: null, ask: false };

  // One payment, or no regular gap we recognise: count it while recent, never ask (we can't say what's "missed").
  if (!c || cycle === "unknown") {
    const recent = now - last <= (c ?? 3);
    return { cycle, state: recent ? "active" : "inactive", nextExpected: null, lapsingSince: null, ask: false };
  }
  const reask = answer?.answer === "still_use" && !declaredActive;
  // Round-2 3a: with the last payment's date and how far the books go, judge by days.
  if (days.lastPaid && days.booksThrough && days.today) {
    const leeway = days.leewayDays ?? 7;
    const e1 = addMonths(days.lastPaid, c);
    if (!missed(e1, days.today, days.booksThrough, leeway)) return { cycle, state: "active", nextExpected: e1, lapsingSince: null, ask: false };
    const lapsingSince = addDays(e1, leeway);
    const e2 = addMonths(days.lastPaid, 2 * c);
    if (!missed(e2, days.today, days.booksThrough, leeway) || reask) return { cycle, state: "lapsing", nextExpected: e1, lapsingSince, ask: true };
    return { cycle, state: "inactive", nextExpected: e1, lapsingSince: null, ask: false };
  }
  const since = now - last; // whole months since the last paid month
  const nextExpected = monthEnd(last + c);
  // Month fallback (no dates yet): expected during month last+c, missed from the next month end.
  if (since <= c) return { cycle, state: "active", nextExpected, lapsingSince: null, ask: false };
  const lapsingSince = addDays(nextExpected, 7);
  // A "still use it" that has run out (6 months) means ask again rather than drop it.
  if (since <= 2 * c || reask) return { cycle, state: "lapsing", nextExpected, lapsingSince, ask: true };
  return { cycle, state: "inactive", nextExpected, lapsingSince: null, ask: false };
}

/** An unanswered lapsing question older than 30 days → a queue item, so our team sees the pattern. */
export function lapsingNeedsReview(l: Lifecycle, asAt: string): boolean {
  return l.state === "lapsing" && !!l.lapsingSince && Date.parse(asAt) - Date.parse(l.lapsingSince) > LAPSING_QUEUE_DAYS * 86_400_000;
}
