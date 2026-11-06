/** M6: review queue — dedupe, resolution side effects (recompute), audit log. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { accounts, auditLog, detectedApps, flags, orgs, reviewQueue, statements } from "@/db/schema";
import { recompute, runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { enqueue } from "@/lib/queue/enqueue";
import { listQueue, resolveItem } from "@/lib/queue/resolve";
import { HttpError } from "@/lib/api";

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

const latestFlag = async (lineKey: string) =>
  withOrg(orgId, async (tx) => (await tx.select().from(flags).where(eq(flags.lineKey, lineKey)).orderBy(desc(flags.createdAt)).limit(1))[0]);
const open = async (kind: string) => (await listQueue({ kind }))[0]!;

describe("enqueue", () => {
  it("dedupes on (kind, ref) regardless of key order", async () => {
    const ref = { org_id: orgId, x: 1, y: 2 };
    expect(await enqueue({ kind: "flag_disputed", orgId, ref, reason: "a" })).toBe(true);
    expect(await enqueue({ kind: "flag_disputed", orgId, ref: { y: 2, x: 1, org_id: orgId }, reason: "b" })).toBe(false);
  });
});

describe("listQueue", () => {
  it("lists open items oldest first, filterable by kind", async () => {
    const all = await listQueue();
    expect(all.length).toBeGreaterThanOrEqual(4);
    const times = all.map((i) => i.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect((await listQueue({ kind: "account_mapping" })).every((i) => i.kind === "account_mapping")).toBe(true);
  });
});

describe("resolveItem", () => {
  it("account_mapping: confirming a category flips the line from queued to a computed state", async () => {
    expect((await latestFlag("pl:999"))!.state).toBe("queued");
    const item = await open("account_mapping");
    const out = await resolveItem(item.id, "svinujan10@gmail.com", { action: "map", category: "office_general" });
    expect(out.recomputed).toBe(true);
    const after = (await latestFlag("pl:999"))!;
    expect(after.state).not.toBe("queued");
    expect(after.ruleId).toBe("card_spend"); // office_general → card_spend rule
    const db = await adminDb();
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "queue.done.account_mapping"));
    expect(a!.actor).toBe("svinujan10@gmail.com");
  });

  it("refuses an action that doesn't fit the kind, and a second resolution", async () => {
    const item = await open("fingerprint_check");
    await expect(resolveItem(item.id, "a", { action: "map", category: "rent" })).rejects.toMatchObject({ status: 400 });
    const done = (await listQueue({ kind: "account_mapping", status: "done" }))[0]!;
    await expect(resolveItem(done.id, "a", { action: "dismiss" })).rejects.toBeInstanceOf(HttpError);
  });

  it("fingerprint_check: confirming adds an alias and the app is detected", async () => {
    const item = await open("fingerprint_check");
    const out = await resolveItem(item.id, "admin", { action: "confirm" });
    expect(out.effects[0]).toBe('alias "fathum" → fathom');
    const rows = await withOrg(orgId, (tx) => tx.select().from(detectedApps).where(eq(detectedApps.appId, "fathom")));
    expect(rows[0]).toMatchObject({ present: true, monthsSeen: 4 });
  });

  it("unknown_supplier: dismiss closes it without side effects", async () => {
    const item = await open("unknown_supplier");
    const out = await resolveItem(item.id, "admin", { action: "dismiss", note: "Tillflow is a till roll supplier" });
    expect(out.item.status).toBe("dismissed");
    expect(out.recomputed).toBe(false);
  });

  it("cashflow_unreconciled: cash flow lines stay queued until a person accepts the difference", async () => {
    // Break the cash flow: remove the type from Accounts Receivable, then recompute from stored rows.
    await withOrg(orgId, (tx) => tx.update(accounts).set({ type: "" }).where(eq(accounts.code, "610")));
    await recompute(orgId);
    const [cf] = await withOrg(orgId, (tx) => tx.select().from(statements).where(eq(statements.kind, "cf")).orderBy(desc(statements.createdAt)).limit(1));
    expect(cf!.reconciled).toBe(false);
    expect((await latestFlag("cf:825"))!.state).toBe("queued");

    const item = await open("cashflow_unreconciled");
    expect(item.reason).toContain("£33500.00 unexplained");
    expect(item.reason).toContain("Accounts Receivable");
    await resolveItem(item.id, "admin", { action: "accept", note: "AR type fixed in Xero next month" });
    expect((await latestFlag("cf:825"))!.state).toBe("flagged");
  });

  it("every resolution is in the audit log", async () => {
    const db = await adminDb();
    const resolved = await db.select().from(reviewQueue).where(and(eq(reviewQueue.orgId, orgId)));
    const closed = resolved.filter((r) => r.status !== "open").length;
    const audits = await db.select().from(auditLog);
    expect(audits.length).toBe(closed);
  });
});

describe("cashflow_unreconciled closes itself when a later run reconciles", () => {
  const setArType = (type: string) => withOrg(orgId, (tx) => tx.update(accounts).set({ type }).where(eq(accounts.code, "610")));
  const cfItem = async () => {
    const db = await adminDb();
    return (await db.select().from(reviewQueue).where(and(eq(reviewQueue.orgId, orgId), eq(reviewQueue.kind, "cashflow_unreconciled"))))[0];
  };
  const audits = async (action: string) =>
    (await (await adminDb()).select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.actor, "system")))).length;

  it("an item a person accepted stays closed when the problem recurs", async () => {
    // The previous suite left Accounts Receivable without a type and the item accepted by a person.
    await recompute(orgId);
    const item = (await cfItem())!;
    expect(item.status).toBe("done");
    expect((item.resolution as { auto?: boolean }).auto).toBeUndefined();
  });

  it("fix → auto-closed with an audit row; break again → reopened; fix → closed again", async () => {
    const db = await adminDb();
    await db.delete(reviewQueue).where(and(eq(reviewQueue.orgId, orgId), eq(reviewQueue.kind, "cashflow_unreconciled")));

    await recompute(orgId); // still broken → a fresh open item
    expect((await cfItem())!.status).toBe("open");

    await setArType("CURRENT");
    await recompute(orgId);
    let item = (await cfItem())!;
    expect(item.status).toBe("done");
    expect(item.assignee).toBe("system");
    expect(item.resolution).toMatchObject({ auto: true, by: "system" });
    expect(await audits("queue.done.cashflow_unreconciled")).toBe(1);

    await setArType("");
    await recompute(orgId);
    item = (await cfItem())!;
    expect(item.status).toBe("open");
    expect(item.resolution).toBeNull();
    expect(await audits("queue.reopened.cashflow_unreconciled")).toBe(1);

    await setArType("CURRENT");
    await recompute(orgId);
    expect((await cfItem())!.status).toBe("done");
    expect(await audits("queue.done.cashflow_unreconciled")).toBe(2);
  });
});
