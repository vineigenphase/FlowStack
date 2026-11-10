/** v1.1 B: monthly statements, per-month cash flow, and trend signals (BACKEND §3.4, §4, §7.3). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { orgs, reviewQueue, statements } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { computeTrends, type Month } from "@/lib/signals/trends";
import { computeFlags, type FlagCtx } from "@/lib/signals/compute";
import { apps, rulesFile } from "@/lib/catalog/load";
import { monthEndBack, monthIndex, monthStart } from "@/lib/sync/periods";
import { monthlyView } from "@/lib/read/views";

const RULES = { debtor_days: { threshold: 45, min_change: 7 }, cash_headroom_months: { threshold: 6, min_change: 1 } };

/** 12 months, newest first, revenue £100k a month; debtors chosen to give the days we want. */
function months(debtorDays: number[], bank: number[] = Array(12).fill(500_000)): Month[] {
  return debtorDays.map((d, i) => ({
    end: monthEndBack("2026-10-31", i),
    bs: { trade_debtors: (d / 365) * 100_000 * 12, bank: bank[i]! },
    revenue: 100_000,
    costOfSales: 40_000,
    overheads: 30_000,
  }));
}

describe("trend signals (pure)", () => {
  it("debtor days rising 38 → 52 fires, with the £ tied up by the rise", () => {
    const t = computeTrends(months([52, 49, 44, 38, 38, 38, 38, 38, 38, 38, 38, 38]), RULES).find((x) => x.key === "debtor_days")!;
    expect(t).toMatchObject({ latest: 52, threeMonthsAgo: 38, change: 14, fires: true });
    // (52 − 38) ÷ 365 × (£300k × 4) = £46,027.40
    expect(t.value).toBeCloseTo(46_027.4, 1);
    expect(t.series).toHaveLength(12);
    expect(t.series.at(-1)!.value).toBeNull(); // the oldest months lack 3 months of revenue
  });
  it("level alone doesn't fire: high but flat", () => {
    const t = computeTrends(months(Array(12).fill(60)), RULES).find((x) => x.key === "debtor_days")!;
    expect(t.fires).toBe(false);
    expect(t.value).toBe(0);
  });
  it("rising but under the threshold doesn't fire", () => {
    expect(computeTrends(months([40, 36, 33, 30, 30, 30, 30, 30, 30, 30, 30, 30]), RULES)[0]!.fires).toBe(false);
  });
  it("cash headroom falling below 6 months fires; a business gaining cash never does", () => {
    // Bank falls £50k a month: 300k now = 6 months; 3 months ago 450k / 50k = 9 → falls by 3.
    const falling = Array.from({ length: 12 }, (_, i) => 250_000 + i * 50_000);
    const h = computeTrends(months(Array(12).fill(30), falling), RULES).find((x) => x.key === "cash_headroom_months")!;
    expect(h).toMatchObject({ latest: 5, threeMonthsAgo: 8, fires: true });
    expect(h.value).toBe(50_000); // (6 − 5) × £50k
    const rising = Array.from({ length: 12 }, (_, i) => 900_000 - i * 50_000);
    expect(computeTrends(months(Array(12).fill(30), rising), RULES).find((x) => x.key === "cash_headroom_months")!.fires).toBe(false);
  });
  it("a trend flag is ranked like any other: rule, base = revenue, covered by a chasing app", () => {
    const rf = rulesFile();
    const ctx: FlagCtx = {
      revenue: 1_200_000, totalAssets: 900_000, monthsInPeriod: 12, cfReconciled: true, rules: rf.rules, apps: apps(), markets: ["UK"],
      inUse: new Map(), prices: new Map(), overrides: new Map(), tb: new Map(), bands: { high: 0.1, medium: 0.02 }, scoring: rf.scoring,
    };
    const line = { kind: "trend" as const, lineKey: "trend:debtor_days", xeroAccountId: null, code: null, name: "Debtor days rising", category: "trend:debtor_days", value: 46_027.4, extra: { trend: { latest: 52 } } };
    const [f] = computeFlags([line], ctx);
    expect(f).toMatchObject({ state: "flagged", ruleId: "trend_debtor_days", band: "medium", evidence: { trend: { latest: 52 } } });
    expect(f!.recommendations.length).toBeGreaterThan(0);
    const chaser = apps().find((a) => a.categories.includes("billing_receivables"))!;
    const [covered] = computeFlags([line], { ...ctx, inUse: new Map([[chaser.id, { appId: chaser.id, spend12m: 600, monthsSeen: 12 }]]) });
    expect(covered!.state).toBe("covered");
  });
  it("month helpers", () => {
    expect(monthEndBack("2026-10-31", 0)).toBe("2026-10-31");
    expect(monthEndBack("2026-10-31", 8)).toBe("2026-02-28");
    expect(monthStart("2026-10-31")).toBe("2026-10-01");
    expect(monthIndex("2026-10-31", "2026-03-31")).toBe(7);
    expect(monthIndex("2026-10-31", "2025-03-31")).toBeNull();
  });
});

describe("monthly statements in a refresh (sample org)", () => {
  let close: () => Promise<void>;
  let orgId: string;
  beforeAll(async () => {
    const h = await freshDb();
    close = h.close;
    const db = await adminDb();
    orgId = (await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true }).returning())[0]!.id;
    await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
  });
  afterAll(() => close());

  it("stores 12 month-end balance sheets and 12 monthly P&Ls, and the opening balance sheet came from the same call", async () => {
    const s = await withOrg(orgId, (tx) => tx.select().from(statements));
    const count = (k: string) => s.filter((x) => x.kind === k).length;
    expect(count("bs_monthly")).toBe(12);
    expect(count("pl_monthly")).toBe(12);
    const open = s.find((x) => x.kind === "bs" && x.periodTo === "2026-03-31")!;
    const m7 = s.find((x) => x.kind === "bs_monthly" && x.periodTo === "2026-03-31")!;
    expect(open.totals.total_assets).toBe(m7.totals.total_assets);
  });

  it("each month of this financial year has a cash flow that reconciles; no queue item", async () => {
    const cf = await withOrg(orgId, (tx) => tx.select().from(statements).where(eq(statements.kind, "cf_monthly")));
    expect(cf).toHaveLength(7); // Apr–Oct 2026
    expect(cf.every((c) => c.reconciled)).toBe(true);
    const db = await adminDb();
    const q = await db.select().from(reviewQueue).where(and(eq(reviewQueue.kind, "cashflow_unreconciled"), eq(reviewQueue.orgId, orgId)));
    expect(q).toHaveLength(0);
  });

  it("statements?months=12: the monthly series, newest first", async () => {
    const v = await monthlyView(orgId, "bs", 12);
    expect(v!.months).toHaveLength(12);
    expect(v!.months[0]!.to).toBe("2026-10-31");
    expect(v!.months[0]!.lines.some((l) => l.category === "trade_debtors")).toBe(true);
    expect((await monthlyView(orgId, "cf", 3))!.months.map((m) => m.reconciled)).toEqual([true, true, true]);
  });
});
