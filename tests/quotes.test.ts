/** CLAUDE.md §7.3b quote requests: situation only (no figures), queued for a person, replies + response time. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { orgs, reviewQueue } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { addReply, medianDays, orgQuotes, requestQuotes, responseTime } from "@/lib/quotes";
import { resolveItem } from "@/lib/queue/resolve";

let close: () => Promise<void>;
let orgId: string;

beforeAll(async () => {
  const h = await freshDb();
  close = h.close;
  const db = await adminDb();
  orgId = (await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true, industry: "hospitality" }).returning())[0]!.id;
  await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
});
afterAll(() => close());

describe("quote requests", () => {
  it("stores only the situation (no figures) and queues it for our team", async () => {
    const r = await requestQuotes(orgId, null, { appIds: ["staffology", "brightpay"], lineKey: "pl:477", sites: 3, headcount: 85, mustHaves: "tronc", replyTo: "fd@copperpot.test" });
    expect(r.situation).toEqual({
      industry: "Hospitality",
      sizeBand: "£1m–£5m revenue",
      markets: ["UK"],
      sites: 3,
      headcount: 85,
      keeps: expect.arrayContaining(["Deputy", "Lightspeed Restaurant"]),
      mustHaves: "tronc",
    });
    expect(JSON.stringify(r.situation)).not.toMatch(/\d{4,}/);
    expect(r.situation.keeps).not.toContain("Xero");
    const db = await adminDb();
    const [q] = await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "quote_request"));
    expect(q!.reason).toContain("Staffology Payroll, BrightPay");
  });

  it("replies need the request to be sent, and only from vendors that were asked", async () => {
    const [req] = await orgQuotes(orgId, "pl:477");
    await expect(addReply(req!.id, { appId: "staffology", priceText: "£4 per payslip" }, "luke")).rejects.toMatchObject({ status: 409 });
    const db = await adminDb();
    const [q] = await db.select().from(reviewQueue).where(and(eq(reviewQueue.kind, "quote_request"), eq(reviewQueue.status, "open")));
    await resolveItem(q!.id, "luke", { action: "mark_sent" });
    await expect(addReply(req!.id, { appId: "dext", priceText: "x" }, "luke")).rejects.toMatchObject({ status: 422 });
    await addReply(req!.id, { appId: "staffology", priceMonthly: 340, priceText: "£4 per payslip, about £340 a month", terms: { "Minimum term": "12 months" } }, "luke");
    const [after] = await orgQuotes(orgId, "pl:477");
    expect(after!.vendors.find((v) => v.appId === "staffology")!.reply).toMatchObject({ priceMonthly: 340 });
    expect(after!.vendors.find((v) => v.appId === "brightpay")!.reply).toBeNull();
  });

  it("response time: median days, only from 3+ replies", async () => {
    const d = (n: number) => new Date(Date.UTC(2026, 10, 1 + n));
    expect(medianDays([{ sentAt: d(0), receivedAt: d(2) }, { sentAt: d(0), receivedAt: d(4) }])).toBeNull();
    expect(medianDays([{ sentAt: d(0), receivedAt: d(2) }, { sentAt: d(0), receivedAt: d(4) }, { sentAt: d(0), receivedAt: d(9) }])).toBe(4);
    expect(await responseTime("staffology")).toEqual({ days: null, n: 1 });
  });
});
