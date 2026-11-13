/** Apps step, incremental (13 Nov 2026): rebuild only from the earliest month a change touches. No network. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { orgs, supplierSpend } from "@/db/schema";
import { FULL_REBUILD_DAYS, rebuildFrom, syncAppsInUse } from "@/lib/detect";
import { SpendAggregator } from "@/lib/detect/aggregate";
import type { XeroCall, XeroClient, XeroResult } from "@/lib/xero/client";

type Rec = { id: string; kind: "bill" | "bank"; date: string; updated: string; total: number; status: string; contact: string };

/** Honours what the real API does for these calls: Date>= in `where`, Statuses, If-Modified-Since, paging. */
class FakeXero implements XeroClient {
  readonly orgKey = "fake";
  readonly meter = { calls: 0, bytes: 0 };
  readonly limits = { day: null, minute: null, appMinute: null };
  constructor(public recs: Rec[]) {}
  async get(call: XeroCall): Promise<XeroResult> {
    this.meter.calls++;
    const kind = call.key === "invoices" ? "bill" : "bank";
    const m = call.query?.where?.match(/Date>=DateTime\((\d+),(\d+),(\d+)\)/);
    const from = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : new Date(0);
    const statuses = call.query?.Statuses?.split(",");
    const rows = this.recs.filter(
      (r) =>
        r.kind === kind &&
        new Date(r.date) >= from &&
        (!statuses || statuses.includes(r.status)) &&
        (!call.ifModifiedSince || new Date(r.updated) >= call.ifModifiedSince),
    );
    const page = rows.slice(((call.page ?? 1) - 1) * 100, (call.page ?? 1) * 100);
    const contact = (r: Rec) => ({ ContactID: r.contact === "c1" ? "00000000-0000-4000-8000-0000000000c1" : "00000000-0000-4000-8000-0000000000c2", Name: r.contact === "c1" ? "Deputy" : "Pleo Technologies" });
    const json =
      kind === "bill"
        ? { Invoices: page.map((r) => ({ InvoiceID: r.id, Type: "ACCPAY", Contact: contact(r), Date: r.date, Status: r.status, Total: r.total })) }
        : { BankTransactions: page.map((r) => ({ BankTransactionID: r.id, Type: "SPEND", Contact: contact(r), Date: r.date, Status: r.status, Total: r.total, LineItems: [] })) };
    return { status: 200, json, bytes: 1, notModified: false };
  }
}

const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const base = (): Rec[] =>
  months.flatMap((m, i) => [
    { id: `b${i}`, kind: "bill" as const, date: `${m}-15`, updated: `${m}-16T00:00:00Z`, total: 100, status: "PAID", contact: "c1" },
    { id: `t${i}`, kind: "bank" as const, date: `${m}-20`, updated: `${m}-21T00:00:00Z`, total: 50, status: "AUTHORISED", contact: "c2" },
  ]);

let close: () => Promise<void>;
let orgId: string;
beforeAll(async () => {
  close = (await freshDb()).close;
  orgId = (await (await adminDb()).insert(orgs).values({ name: "Incremental Ltd (sample)", sample: true }).returning())[0]!.id;
});
afterAll(() => close());

const spend = () => withOrg(orgId, (tx) => tx.select().from(supplierSpend).orderBy(asc(supplierSpend.month), asc(supplierSpend.source)));

describe("rebuildFrom", () => {
  const since = "2025-10-01";
  const now = new Date("2026-11-05T10:00:00Z");
  it("rebuilds everything on the first run and when the last run is too old", async () => {
    const x = new FakeXero(base());
    expect(await rebuildFrom(x, since, null, now)).toBe(since);
    expect(await rebuildFrom(x, since, new Date(now.getTime() - (FULL_REBUILD_DAYS + 1) * 86_400_000), now)).toBe(since);
    expect(x.meter.calls).toBe(0);
  });
  it("nothing changed → nothing to rebuild; a change → from its month; voided bills count as changes", async () => {
    const cursor = new Date("2026-11-04T10:00:00Z");
    const recs = base();
    expect(await rebuildFrom(new FakeXero(recs), since, cursor, now)).toBeNull();
    recs.push({ id: "late", kind: "bank", date: "2026-08-03", updated: "2026-11-05T09:00:00Z", total: 20, status: "AUTHORISED", contact: "c2" });
    expect(await rebuildFrom(new FakeXero(recs), since, cursor, now)).toBe("2026-08-01");
    recs.find((r) => r.id === "b3")!.status = "VOIDED";
    recs.find((r) => r.id === "b3")!.updated = "2026-11-05T09:30:00Z";
    expect(await rebuildFrom(new FakeXero(recs), since, cursor, now)).toBe("2026-02-01");
  });
});

describe("syncAppsInUse", () => {
  it("a daily refresh re-reads only the changed months and ends with the same totals as a full rebuild", async () => {
    const recs = base();
    const asAt = "2026-10-31";
    await syncAppsInUse(orgId, new FakeXero(recs), { asAt, now: new Date("2026-11-04T10:00:00Z") });
    expect((await spend()).length).toBe(24);

    // Next day: one new bill in October, and a September bill voided.
    recs.push({ id: "new", kind: "bill", date: "2026-10-28", updated: "2026-11-05T08:00:00Z", total: 40, status: "AUTHORISED", contact: "c1" });
    Object.assign(recs.find((r) => r.id === "b10")!, { status: "VOIDED", updated: "2026-11-05T08:30:00Z" });
    const x = new FakeXero(recs);
    await syncAppsInUse(orgId, x, { asAt, now: new Date("2026-11-05T10:00:00Z") });
    // 2 change-check calls + 2 calls for Sep–Oct, instead of a 13-month pull.
    expect(x.meter.calls).toBe(4);

    const agg = new SpendAggregator();
    const all = new FakeXero(recs);
    const bills = ((await all.get({ key: "invoices", path: "", query: { Statuses: "AUTHORISED,PAID" } })).json as { Invoices: never[] }).Invoices;
    const bank = ((await all.get({ key: "banktransactions", path: "" })).json as { BankTransactions: never[] }).BankTransactions;
    const { InvoicesResponse, BankTransactionsResponse } = await import("@/lib/xero/schemas");
    agg.addBills(InvoicesResponse.parse({ Invoices: bills }).Invoices);
    agg.addSpend(BankTransactionsResponse.parse({ BankTransactions: bank }).BankTransactions);
    const key = (r: { month: string; source: string; contactId: string; amount: number }) => `${r.month}|${r.source}|${r.contactId}|${r.amount}`;
    expect((await spend()).map(key).sort()).toEqual(agg.result().map(key).sort());
    expect((await spend()).find((r) => r.month === "2026-09-01" && r.source === "bill")).toBeUndefined();
  });
});
