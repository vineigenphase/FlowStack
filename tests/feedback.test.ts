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
    const f = await flagFor("pl:445");
    expect(f.state).toBe("flagged");
    const out = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "no", note: "Dext captures these bills" });
    expect(out.state).toBe("marked_fine");
    expect((await flagFor("pl:445")).id).toBe(f.id);
    const ov = await withOrg(orgId, (tx) => tx.select().from(lineOverrides));
    expect(ov).toEqual([expect.objectContaining({ lineKey: "pl:445", ruleId: "supplier_bills", state: "marked_fine" })]);
    const db = await adminDb();
    const q = await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "flag_disputed"));
    expect(q[0]!.reason).toContain("supplier_bills v1");
    expect(q[0]!.reason).toContain("Dext captures these bills");
  });

  it("the override survives a recompute, and feedback survives with it", async () => {
    await recompute(orgId);
    expect((await flagFor("pl:445")).state).toBe("marked_fine");
    const fb = await withOrg(orgId, (tx) => tx.select().from(flagFeedback));
    expect(fb).toHaveLength(1);
  });

  it('"yes" after "no" undoes the override', async () => {
    const f = await flagFor("pl:445");
    const out = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "yes" });
    expect(out.state).toBe("flagged");
    expect(await withOrg(orgId, (tx) => tx.select().from(lineOverrides).where(and(eq(lineOverrides.lineKey, "pl:445"))))).toHaveLength(0);
  });

  it("refuses feedback on a fine line", async () => {
    const f = await flagFor("pl:469");
    await expect(submitFeedback({ orgId, flagId: f.id, userId: null, answer: "no" })).rejects.toMatchObject({ status: 422 });
  });

  it("FP report uses each flag's latest answer, per rule with version", async () => {
    const wages = await flagFor("pl:477");
    await submitFeedback({ orgId, flagId: wages.id, userId: null, answer: "yes" });
    const r = await fpReport();
    // pl:445 latest answer is "yes", pl:477 "yes" → 0 of 2.
    expect(r.overall).toEqual({ answered: 2, no: 0, rate: 0 });
    expect(r.byRule.map((x) => x.key)).toEqual(["payroll_no_bridge@v1", "supplier_bills@v1"]);
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
    expect(r.overall).toEqual({ answered: 2, no: 1, rate: 0.5 });
    expect(r.byRule).toEqual([
      { key: "r@v1", answered: 1, no: 1, rate: 1 },
      { key: "r@v2", answered: 1, no: 0, rate: 0 },
    ]);
    expect(r.byWeek.map((w) => w.key)).toEqual(["2026-W45", "2026-W46"]);
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
