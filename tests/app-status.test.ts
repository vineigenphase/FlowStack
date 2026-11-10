/** v1.1 C: lapsing questions, answers and declared apps, end to end on stored aggregates (no Xero calls). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { appStatusAnswers, detectedApps, orgs, reviewQueue, supplierSpend } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { detect } from "@/lib/detect";
import { answerAppStatus, appQuestions } from "@/lib/detect/status";

let close: () => Promise<void>;
let orgId: string;
let other: string;
const asAt = "2026-10-31";

const spend = (contactId: string, name: string, months: string[]) =>
  months.map((month) => ({ orgId, contactId, contactName: name, nameNorm: name.toLowerCase(), month, amount: 120, source: "bank" as const }));

beforeAll(async () => {
  const h = await freshDb();
  close = h.close;
  const db = await adminDb();
  orgId = (await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true }).returning())[0]!.id;
  other = (await db.insert(orgs).values({ name: "Other Ltd" }).returning())[0]!.id;
  await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
  // Spendesk paid monthly Jan–Aug 2026, nothing since.
  await withOrg(orgId, async (tx) => {
    await tx.insert(supplierSpend).values([
      ...spend("00000000-0000-4000-8000-0000000000a1", "Spendesk", ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"]),
    ]);
    await detect(tx, orgId, asAt, null);
  });
});
afterAll(() => close());

const app = async (id: string) => (await withOrg(orgId, (tx) => tx.select().from(detectedApps).where(eq(detectedApps.appId, id))))[0];

describe("app lifecycle", () => {
  it("one missed payment: lapsing, still counts as in use, and we ask", async () => {
    expect(await app("spendesk")).toMatchObject({ state: "lapsing", cycle: "monthly", present: true, nextExpected: "2026-09-30" });
    const qs = await appQuestions(orgId);
    expect(qs).toContainEqual(expect.objectContaining({ kind: "still_use", appId: "spendesk", lastSeen: "2026-08-01" }));
  });

  it("still use it → declared, no question; answers are private to the business", async () => {
    await answerAppStatus(orgId, "spendesk", null, { answer: "still_use" });
    expect(await app("spendesk")).toMatchObject({ state: "declared", present: true });
    expect((await appQuestions(orgId)).some((q) => q.appId === "spendesk")).toBe(false);
    expect(await withOrg(other, (tx) => tx.select().from(appStatusAnswers))).toHaveLength(0);
  });

  it("moved to Ramp → Spendesk inactive, Ramp declared (no payments yet), and our team checks Ramp's supplier names", async () => {
    await answerAppStatus(orgId, "spendesk", null, { answer: "moved", replacedBy: "ramp" });
    expect(await app("spendesk")).toMatchObject({ state: "inactive", present: false });
    expect(await app("ramp")).toMatchObject({ state: "declared", present: true, spend12m: 0 });
    const db = await adminDb();
    const q = await db.select().from(reviewQueue).where(and(eq(reviewQueue.orgId, orgId), eq(reviewQueue.kind, "fingerprint_check")));
    expect(q.some((x) => x.reason.includes("moved from Spendesk to Ramp"))).toBe(true);
  });

  it("refuses an app we don't know", async () => {
    await expect(answerAppStatus(orgId, "not-an-app", null, { answer: "stopped" })).rejects.toMatchObject({ status: 404 });
  });
});
