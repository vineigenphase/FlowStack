/** M7: feedback → overrides, flag_disputed, FP report; eval scoring. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { flagFeedback, flags, lineOverrides, orgs, reviewQueue } from "@/db/schema";
import { recompute, runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { fpReport, fpReportFrom, isoWeek, submitFeedback } from "@/lib/feedback";
import { scoreEval, type LineResult } from "@/lib/eval/run";

let close: () => Promise<void>;
let orgId: string;

beforeAll(async () => {
  const h = await freshDb();
  close = h.close;
  const db = await adminDb();
  const [o] = await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true }).returning();
  orgId = o!.id;
  await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
});
afterAll(() => close());

const flagFor = async (lineKey: string) => (await withOrg(orgId, (tx) => tx.select().from(flags).where(eq(flags.lineKey, lineKey))))[0]!;

describe("feedback", () => {
  it('"no" marks the line fine for this org, keeps the flag id, and opens flag_disputed', async () => {
    const f = await flagFor("pl:310");
    expect(f.state).toBe("flagged");
    const out = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "no", note: "MarketMan is being rolled out" });
    expect(out.state).toBe("marked_fine");
    expect((await flagFor("pl:310")).id).toBe(f.id);
    const ov = await withOrg(orgId, (tx) => tx.select().from(lineOverrides));
    expect(ov).toEqual([expect.objectContaining({ lineKey: "pl:310", ruleId: "cost_of_sales_stock", state: "marked_fine" })]);
    const db = await adminDb();
    const q = await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "flag_disputed"));
    expect(q[0]!.reason).toContain("cost_of_sales_stock v2");
    expect(q[0]!.reason).toContain("MarketMan is being rolled out");
  });

  it("the override survives a recompute, and feedback survives with it", async () => {
    await recompute(orgId);
    expect((await flagFor("pl:310")).state).toBe("marked_fine");
    const fb = await withOrg(orgId, (tx) => tx.select().from(flagFeedback));
    expect(fb).toHaveLength(1);
  });

  it('"yes" after "no" undoes the override', async () => {
    const f = await flagFor("pl:310");
    const out = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "yes" });
    expect(out.state).toBe("flagged");
    expect(await withOrg(orgId, (tx) => tx.select().from(lineOverrides).where(and(eq(lineOverrides.lineKey, "pl:310"))))).toHaveLength(0);
  });

  it("v1.1 D: not now snoozes 90 days; numbers wrong queues it with a mapping item; an app they use covers it", async () => {
    const f = await flagFor("pl:310");
    const snoozed = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "not_now", now: new Date("2026-11-09T10:00:00Z") });
    expect(snoozed.state).toBe("snoozed");
    const [ov] = await withOrg(orgId, (tx) => tx.select().from(lineOverrides).where(eq(lineOverrides.lineKey, "pl:310")));
    expect(ov).toMatchObject({ state: "snoozed", until: "2027-02-07" });

    const wrong = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "numbers_wrong" });
    expect(wrong.state).toBe("queued");
    const db = await adminDb();
    const mapping = await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "account_mapping"));
    expect(mapping.some((q) => q.reason.includes("pl:310"))).toBe(true);

    await expect(submitFeedback({ orgId, flagId: f.id, userId: null, answer: "already_use_app" })).rejects.toMatchObject({ status: 422 });
    const uses = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "already_use_app", appId: "marketman" });
    expect(uses.state).toBe("covered");
    const after = await flagFor("pl:310");
    expect(after.evidence).toMatchObject({ covered_by: "marketman", declared: true });
    // An app we don't know goes to our team to add; the line stays as it was until then.
    await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "already_use_app", appName: "Stocky McStockface" });
    const fp = await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "fingerprint_check"));
    expect(fp.some((q) => q.reason.includes("Stocky McStockface"))).toBe(true);
    // Back to "yes" so the later report test starts clean.
    await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "yes" });
  });

  it("refuses feedback on a fine line", async () => {
    const f = await flagFor("pl:469");
    await expect(submitFeedback({ orgId, flagId: f.id, userId: null, answer: "no" })).rejects.toMatchObject({ status: 422 });
  });

  it("FP report uses each flag's latest answer, per rule with version", async () => {
    const wages = await flagFor("pl:477");
    await submitFeedback({ orgId, flagId: wages.id, userId: null, answer: "yes" });
    const r = await fpReport();
    // pl:310 latest answer is "yes", pl:477 "yes" → 0 of 2.
    expect(r.overall).toEqual({ answered: 2, falsePositives: 0, misses: 0, dataQuality: 0, notNow: 0, rate: 0, missRate: 0, dataQualityRate: 0 });
    expect(r.byRule.map((x) => x.key)).toEqual(["cost_of_sales_stock@v2", "payroll_no_bridge@v2"]);
  });
});

describe("fpReportFrom", () => {
  const d = (s: string) => new Date(s);
  it("counts the latest answer per flag and groups by ISO week", () => {
    const r = fpReportFrom([
      { flagId: "a", ruleId: "r", ruleVersion: 1, answer: "yes", createdAt: d("2026-11-02T10:00:00Z") },
      { flagId: "a", ruleId: "r", ruleVersion: 1, answer: "no", createdAt: d("2026-11-03T10:00:00Z") },
      { flagId: "b", ruleId: "r", ruleVersion: 2, answer: "yes", createdAt: d("2026-11-10T10:00:00Z") },
    ]);
    expect(r.overall).toMatchObject({ answered: 2, falsePositives: 1, rate: 0.5 });
    expect(r.byRule).toEqual([
      { key: "r@v1", answered: 1, falsePositives: 1, misses: 0, dataQuality: 0, notNow: 0, rate: 1, missRate: 0, dataQualityRate: 0 },
      { key: "r@v2", answered: 1, falsePositives: 0, misses: 0, dataQuality: 0, notNow: 0, rate: 0, missRate: 0, dataQualityRate: 0 },
    ]);
    expect(r.byWeek.map((w) => w.key)).toEqual(["2026-W45", "2026-W46"]);
  });
  it("v1.1 D: FP = (no app needed + numbers wrong) ÷ (yes + those + already use); misses separate; not now in neither", () => {
    const at = d("2026-11-09T10:00:00Z");
    const row = (flagId: string, answer: string) => ({ flagId, ruleId: "r", ruleVersion: 1, answer, createdAt: at });
    const r = fpReportFrom([row("a", "yes"), row("b", "no_app_needed"), row("c", "numbers_wrong"), row("d", "already_use_app"), row("e", "not_now"), row("f", "yes")]);
    expect(r.overall).toEqual({ answered: 5, falsePositives: 2, misses: 1, dataQuality: 0, notNow: 1, rate: 0.4, missRate: 0.2, dataQualityRate: 0 });
  });
  it("round-2 3b: miscoded is data quality, not our false positive; the other sub-reasons are", () => {
    const at = d("2026-11-09T10:00:00Z");
    const row = (flagId: string, answer: string, subReason?: string) => ({ flagId, ruleId: "r", ruleVersion: 1, answer, subReason, createdAt: at });
    const r = fpReportFrom([
      row("a", "yes"),
      row("b", "numbers_wrong", "wrong_category"),
      row("c", "numbers_wrong", "figure_mismatch"),
      row("d", "numbers_wrong", "one_off"),
      row("e", "numbers_wrong", "miscoded"),
      row("f", "already_use_app"),
      row("g", "not_now"),
      row("h", "numbers_wrong"), // before sub-reasons: still ours
    ]);
    expect(r.overall).toEqual({ answered: 7, falsePositives: 4, misses: 1, dataQuality: 1, notNow: 1, rate: 0.571, missRate: 0.143, dataQualityRate: 0.143 });
    expect(r.byWeek[0]).toMatchObject({ key: "2026-W46", dataQuality: 1 });
  });
  it("iso weeks at year boundaries", () => {
    expect(isoWeek(d("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeek(d("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });
});

describe("scoreEval", () => {
  const r = (lineKey: string, ruleId: string, predicted: LineResult["predicted"], expected: LineResult["expected"]): LineResult => ({ org: "o", lineKey, ruleId, predicted, expected, labelled: true });
  it("FP rate = wrong flags ÷ flags; missed rate = labelled flags we missed ÷ labelled flags", () => {
    const s = scoreEval([r("a", "x", "flagged", "flagged"), r("b", "x", "flagged", "covered"), r("c", "y", "fine", "flagged"), r("d", "y", "fine", "fine")]);
    expect(s.overall).toMatchObject({ predictedFlagged: 2, falsePositives: 1, fpRate: 0.5, labelledFlagged: 2, missed: 1, missedRate: 0.5 });
    expect(s.rules.find((x) => x.rule === "y")).toMatchObject({ fpRate: null, missedRate: 1 });
    expect(s.stateAgreement).toBe(0.5);
  });
});

describe("round-2 3b: one-off for this period only, figure mismatch re-fetched", () => {
  it("a one-off override ends with the financial year; after that the line is judged afresh", async () => {
    const [f] = await withOrg(orgId, (tx) => tx.select().from(flags).where(and(eq(flags.state, "flagged"), eq(flags.statementKind, "pl"))));
    const key = f!.lineKey;
    const out = await submitFeedback({ orgId, flagId: f!.id, userId: null, answer: "numbers_wrong", subReason: "one_off" });
    expect(out.state).toBe("marked_fine");
    const [ov] = await withOrg(orgId, (tx) => tx.select().from(lineOverrides).where(eq(lineOverrides.lineKey, key)));
    expect(ov!.until).toBeTruthy();
    // Pretend the period is over: the override no longer applies.
    await withOrg(orgId, (tx) => tx.update(lineOverrides).set({ until: "2000-01-01" }).where(eq(lineOverrides.lineKey, key)));
    await recompute(orgId);
    expect((await flagFor(key)).state).toBe("flagged");
  });

  it("figure_mismatch: Xero still shows our figure → normal item; Xero shows another → high priority with both values", async () => {
    const f = await flagFor("pl:477");
    const same = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "numbers_wrong", subReason: "figure_mismatch" });
    expect(same.figure).toMatchObject({ status: "same" });
    expect(same.message).toMatch(/still shows the figure we hold/);
    const db = await adminDb();
    const q1 = (await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "flag_disputed"))).find((q) => q.reason.includes("pl:477"))!;
    expect(q1.priority).toBe("normal");

    // Our copy is now stale: the re-fetch finds a different figure.
    await withOrg(orgId, (tx) => tx.update(flags).set({ value: 1 }).where(eq(flags.id, f.id)));
    const diff = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "numbers_wrong", subReason: "figure_mismatch" });
    expect(diff.figure).toMatchObject({ status: "different", ours: 1 });
    const q2 = (await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "flag_disputed"))).find((q) => q.reason.includes("pl:477"))!;
    expect(q2.priority).toBe("high");
    expect(q2.reason).toMatch(/Xero now shows £[\d,]+\.\d\d, we hold £1\.00/);
    const { listQueue } = await import("@/lib/queue/resolve");
    expect((await listQueue())[0]!.priority).toBe("high");
  });
});
