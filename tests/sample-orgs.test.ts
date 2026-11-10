/** v1.1 P: the ecommerce and SaaS sample companies refresh cleanly and tell their story (no Xero calls). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { detectedApps, flags, orgs, statements } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";

let close: () => Promise<void>;
beforeAll(async () => {
  close = (await freshDb()).close;
});
afterAll(() => close());

async function refreshSample(set: string, name: string, industry: string) {
  const db = await adminDb();
  const orgId = (await db.insert(orgs).values({ name, sample: true, industry }).returning())[0]!.id;
  const r = await runRefresh(orgId, { client: new FixtureXeroClient(set, orgId), now: new Date("2026-11-04T10:00:00Z") });
  return { orgId, r };
}

describe.each([
  { set: "demo-uk-ecommerce", name: "Northwind Goods Ltd (sample)", industry: "ecommerce", trend: "trend:stock_days", apps: ["shopify", "a2x", "amazon_seller", "paypal"] },
  { set: "demo-uk-saas", name: "Lumen Analytics Ltd (sample)", industry: "saas", trend: "trend:debtor_days", apps: ["chargebee", "stripe", "chartmogul"] },
])("$set", ({ set, name, industry, trend, apps }) => {
  let orgId: string;
  beforeAll(async () => {
    const out = await refreshSample(set, name, industry);
    orgId = out.orgId;
    expect(out.r.status).toBe("ok");
  });

  it("the year-to-date cash flow and every month of this year reconcile", async () => {
    const s = await withOrg(orgId, (tx) => tx.select().from(statements));
    expect(s.find((x) => x.kind === "cf")!.reconciled).toBe(true);
    const months = s.filter((x) => x.kind === "cf_monthly");
    expect(months).toHaveLength(7);
    expect(months.every((m) => m.reconciled)).toBe(true);
  });

  it("finds the apps in its bills and card spend", async () => {
    const found = (await withOrg(orgId, (tx) => tx.select().from(detectedApps).where(eq(detectedApps.present, true)))).map((d) => d.appId);
    expect(found).toEqual(expect.arrayContaining(apps));
  });

  it(`flags its trend (${trend}) with the 12-month series as evidence`, async () => {
    const [f] = await withOrg(orgId, (tx) => tx.select().from(flags).where(eq(flags.lineKey, trend)));
    expect(f).toBeDefined();
    expect(f!.statementKind).toBe("trend");
    expect((f!.evidence as { trend: { series: unknown[] } }).trend.series).toHaveLength(12);
  });
});
