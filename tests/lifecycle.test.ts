/** v1.1 C: app lifecycle when payments stop (pure). */
import { describe, expect, it } from "vitest";
import { cycleOf, lapsingNeedsReview, lifecycleOf } from "@/lib/detect/lifecycle";

const monthly = (from: string, to: string) => {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  while (d.toISOString().slice(0, 10) <= to) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
};

describe("billing cycle", () => {
  it("monthly, quarterly, annual, unknown", () => {
    expect(cycleOf(monthly("2026-01-01", "2026-10-01")).cycle).toBe("monthly");
    expect(cycleOf(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]).cycle).toBe("quarterly");
    expect(cycleOf(["2025-10-01", "2026-10-01"]).cycle).toBe("annual");
    expect(cycleOf(["2026-03-01"]).cycle).toBe("unknown");
  });
});

describe("states (as at 31 Oct 2026)", () => {
  const asAt = "2026-10-31";
  it("paid this month → active; a brand-new app → new", () => {
    expect(lifecycleOf(monthly("2026-01-01", "2026-10-01"), asAt)).toMatchObject({ state: "active", cycle: "monthly", ask: false });
    expect(lifecycleOf(["2026-10-01"], asAt).state).toBe("new");
  });
  it("one missed monthly payment → lapsing and we ask; two missed → inactive", () => {
    const l = lifecycleOf(monthly("2026-01-01", "2026-08-01"), asAt);
    expect(l).toMatchObject({ state: "lapsing", ask: true, nextExpected: "2026-09-30", lapsingSince: "2026-10-07" });
    expect(lifecycleOf(monthly("2026-01-01", "2026-07-01"), asAt).state).toBe("inactive");
  });
  it("annual apps aren't lapsing between payments", () => {
    expect(lifecycleOf(["2025-03-01", "2026-03-01"], asAt)).toMatchObject({ state: "active", cycle: "annual", nextExpected: "2027-03-31" });
  });
  it("answers: still use → declared for 6 months then ask again; stopped/moved → inactive; new payments win", () => {
    const lapsing = monthly("2026-01-01", "2026-08-01");
    expect(lifecycleOf(lapsing, asAt, { answer: "still_use", at: "2026-10-20" }).state).toBe("declared");
    expect(lifecycleOf(lapsing, "2027-05-31", { answer: "still_use", at: "2026-10-20" })).toMatchObject({ state: "lapsing", ask: true });
    expect(lifecycleOf(lapsing, asAt, { answer: "stopped", at: "2026-10-20" }).state).toBe("inactive");
    expect(lifecycleOf(lapsing, asAt, { answer: "moved", at: "2026-10-20", replacedBy: "ramp" }).state).toBe("inactive");
    // They said stopped in August, then paid again in October: the ledger wins.
    expect(lifecycleOf([...monthly("2026-01-01", "2026-07-01"), "2026-10-01"], asAt, { answer: "stopped", at: "2026-08-15" }).state).not.toBe("inactive");
  });
  it("a declared app with no payments at all (personal card, parent company)", () => {
    expect(lifecycleOf([], asAt, { answer: "declared", at: "2026-10-01" }).state).toBe("declared");
  });
  it("an unanswered lapsing question older than 30 days goes to our team", () => {
    // Quarterly: paid Jan, Apr, Jul; October's payment missed → lapsing from 7 Nov (7 days, round 2); by 31 Dec that is 54 days.
    const q = ["2026-01-01", "2026-04-01", "2026-07-01"];
    const l = lifecycleOf(q, "2026-12-31");
    expect(l).toMatchObject({ state: "lapsing", cycle: "quarterly", lapsingSince: "2026-11-07" });
    expect(lapsingNeedsReview(l, "2026-12-31")).toBe(true);
    expect(lapsingNeedsReview(lifecycleOf(q, "2026-11-30"), "2026-11-30")).toBe(false);
    expect(lapsingNeedsReview(lifecycleOf(monthly("2026-01-01", "2026-08-01"), asAt), asAt)).toBe(false);
  });
});

describe("round-2 3a: 7 days' leeway, and only once the books have caught up", () => {
  // Monthly app, last paid 3 Sep 2026 → next due 3 Oct; missed from 10 Oct if the books reach 10 Oct too.
  const paid = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];
  const days = (today: string, booksThrough: string) => ({ lastPaid: "2026-09-03", booksThrough, today, leewayDays: 7 });
  it("books entered only to 3 weeks ago → no lapse", () => {
    expect(lifecycleOf(paid, "2026-10-31", null, days("2026-11-16", "2026-10-05")).state).toBe("active");
  });
  it("6 days late → active", () => {
    expect(lifecycleOf(paid, "2026-09-30", null, days("2026-10-09", "2026-10-09")).state).toBe("active");
  });
  it("8 days late with later bills → lapsing, asked, and still counts as cover", () => {
    const l = lifecycleOf(paid, "2026-09-30", null, days("2026-10-11", "2026-10-11"));
    expect(l).toMatchObject({ state: "lapsing", ask: true, nextExpected: "2026-10-03", lapsingSince: "2026-10-10" });
  });
  it("a second miss with no answer → inactive; a 'still use it' keeps asking instead", () => {
    expect(lifecycleOf(paid, "2026-10-31", null, days("2026-11-16", "2026-11-12")).state).toBe("inactive");
    expect(lifecycleOf(paid, "2026-10-31", { answer: "still_use", at: "2026-03-01" }, days("2026-11-16", "2026-11-12")).state).toBe("lapsing");
  });
  it("month ends clamp (31 Jan + 1 month = 28 Feb)", async () => {
    const { addMonths } = await import("@/lib/detect/lifecycle");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-15", 12)).toBe("2027-03-15");
  });
});
