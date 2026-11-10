/** v1.1 L: Companies House facts (mocked register; no network). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { appFacts } from "@/db/schema";
import { fetchVendor, refreshVendor, registerUrl, vendorFacts } from "@/lib/vendors/companies-house";
import { apps, clearCatalogCache } from "@/lib/catalog/load";

const register = (company: unknown, pscs: unknown): typeof fetch =>
  (async (url: string | URL | Request) => {
    const u = String(url);
    const body = u.endsWith("/persons-with-significant-control") ? pscs : company;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

describe("Companies House", () => {
  let close: () => Promise<void>;
  beforeAll(async () => {
    close = (await freshDb()).close;
  });
  afterAll(() => close());

  it("incorporation date and changes of control come from the register", async () => {
    const f = register(
      { company_number: "09876543", company_name: "Example Software Ltd", date_of_creation: "2015-03-02", company_status: "active" },
      { items: [{ name: "Founder", notified_on: "2016-04-06", ceased_on: "2021-07-01" }, { name: "Example Holdings Ltd", notified_on: "2021-07-01" }] },
    );
    const r = await fetchVendor("09876543", { fetchImpl: f, key: "k" });
    expect(r).toMatchObject({ incorporated: "2015-03-02", controlChanges: 3, lastControlChange: "2021-07-01" });
    expect(vendorFacts(r!)).toEqual([
      { field: "vendor_incorporated", value: "2015-03-02" },
      { field: "vendor_ownership_changes", value: { changes: 3, last: "2021-07-01" } },
    ]);
  });

  it("no key → nothing fetched; no company number → skipped", async () => {
    expect(await fetchVendor("09876543", { fetchImpl: register({}, {}), key: "" })).toBeNull();
    const noNumber = apps().find((a) => !a.companies_house)!;
    expect(await refreshVendor(noNumber.id, { fetchImpl: register({}, {}), key: "k" })).toMatchObject({ skipped: "no company number" });
  });

  it("stored as verified with the register page as the source", async () => {
    const a = apps()[0]!;
    (a as { companies_house?: string }).companies_house = "09876543"; // in-memory only, for the test
    const f = register({ company_number: "09876543", company_name: "X Ltd", date_of_creation: "2015-03-02" }, { items: [] });
    await refreshVendor(a.id, { fetchImpl: f, key: "k", now: new Date("2026-11-10T09:00:00Z") });
    const db = await adminDb();
    const [row] = await db.select().from(appFacts).where(and(eq(appFacts.appId, a.id), eq(appFacts.field, "vendor_incorporated")));
    expect(row).toMatchObject({ state: "verified", value: "2015-03-02", sourceUrl: registerUrl("09876543"), checkedBy: "companies_house", sample: false });
    clearCatalogCache();
  });
});
