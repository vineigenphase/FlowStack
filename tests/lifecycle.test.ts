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
    expect(l).toMatchObject({ state: "lapsing", ask: true, nextExpected: "2026-09-30", lapsingSince: "2026-10-15" });
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
    // Quarterly: paid Jan, Apr, Jul; October's payment missed → lapsing from 15 Nov; by 31 Dec that's 46 days.
    const q = ["2026-01-01", "2026-04-01", "2026-07-01"];
    const l = lifecycleOf(q, "2026-12-31");
    expect(l).toMatchObject({ state: "lapsing", cycle: "quarterly", lapsingSince: "2026-11-15" });
    expect(lapsingNeedsReview(l, "2026-12-31")).toBe(true);
    expect(lapsingNeedsReview(lifecycleOf(q, "2026-11-30"), "2026-11-30")).toBe(false);
    expect(lapsingNeedsReview(lifecycleOf(monthly("2026-01-01", "2026-08-01"), asAt), asAt)).toBe(false);
  });
});
