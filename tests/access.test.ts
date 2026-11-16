/** NEXT-STEPS P0.5: invite-only connect, testers as design partners, "Report a problem". */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { accessCodes, orgs, reviewQueue, users, waitlist, xeroConnections } from "@/db/schema";
import { resetEnv } from "@/lib/env";
import { AccessDeniedError, approveEmail, createCode, normCode } from "@/lib/access";
import { completeConnect } from "@/lib/auth/connect";
import { subscriptionOf } from "@/lib/api/contract";
import { joinWaitlist } from "@/lib/waitlist";
import { orgFromUrl, submitReport } from "@/lib/report";

process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");

let close: () => Promise<void>;
beforeAll(async () => {
  process.env.ACCESS_MODE = "invite";
  process.env.ADMIN_EMAILS = "boss@example.test";
  resetEnv();
  close = (await freshDb()).close;
});
afterAll(async () => {
  delete process.env.ACCESS_MODE;
  delete process.env.ADMIN_EMAILS;
  resetEnv();
  await close();
});

let n = 0;
const tenant = () => {
  n++;
  return { id: `conn-${n}`, tenantId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, tenantName: `Biz ${n}`, tenantType: "ORGANISATION" };
};
const undone: string[][] = [];
const deps = (email: string, t = tenant(), invite?: string) => ({
  exchange: async () => ({ access_token: "a", refresh_token: "r", expires_in: 1800, id_token: "x", scope: "openid", token_type: "Bearer" }),
  verify: async () => ({ email, sub: email, given_name: "T", family_name: "Ester" }) as never,
  connections: async () => [t] as never,
  undo: async (_a: string, _r: string, ids: string[]) => {
    undone.push(ids);
  },
  invite,
});

describe("invite-only connect", () => {
  it("refuses a stranger, leaves no rows, and removes the connection at Xero", async () => {
    const t = tenant();
    await expect(completeConnect("c", "v", deps("stranger@example.test", t))).rejects.toBeInstanceOf(AccessDeniedError);
    const db = await adminDb();
    expect(await db.select().from(users).where(eq(users.email, "stranger@example.test"))).toEqual([]);
    expect(await db.select().from(xeroConnections).where(eq(xeroConnections.tenantId, t.tenantId))).toEqual([]);
    expect(undone.at(-1)).toEqual([t.id]);
  });

  it("an approved waitlist email gets in as a design partner", async () => {
    await joinWaitlist({ email: "Approved@Example.test", name: "A", company: "B", role: "fd", industry: "saas" });
    await expect(completeConnect("c", "v", deps("approved@example.test"))).rejects.toBeInstanceOf(AccessDeniedError); // not yet approved
    await approveEmail("approved@example.test", "boss@example.test");
    const r = await completeConnect("c", "v", deps("approved@example.test"));
    expect(r.access).toEqual({ via: "approved", tester: true });
    const [o] = await (await adminDb()).select().from(orgs).where(eq(orgs.id, r.created[0]!));
    expect(o!.designPartner).toBe(true);
    expect((await subscriptionOf(o!.id)).status).toBe("design_partner");
    const [w] = await (await adminDb()).select().from(waitlist).where(eq(waitlist.email, "approved@example.test"));
    expect(w!.approvedBy).toBe("boss@example.test");
  });

  it("an invite code works for its uses only (case and spaces don't matter)", async () => {
    const { code } = await createCode({ by: "boss@example.test", maxUses: 1, note: "council" });
    expect(code).toMatch(/^FS-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const typed = ` ${code.toLowerCase()} `;
    expect(normCode(typed)).toBe(code);
    const r = await completeConnect("c", "v", deps("coded@example.test", tenant(), typed));
    expect(r.access.via).toBe("invite");
    await expect(completeConnect("c", "v", deps("second@example.test", tenant(), code))).rejects.toBeInstanceOf(AccessDeniedError);
    const [c] = await (await adminDb()).select().from(accessCodes).where(eq(accessCodes.code, code));
    expect(c!.uses).toBe(1);
  });

  it("an expired code is refused; existing users and admins always get in, not as testers", async () => {
    const { code } = await createCode({ by: "boss", expiresDays: 1 }, new Date("2026-01-01T00:00:00Z"));
    await expect(completeConnect("c", "v", deps("late@example.test", tenant(), code))).rejects.toBeInstanceOf(AccessDeniedError);
    const again = await completeConnect("c", "v", deps("coded@example.test"));
    expect(again.access).toEqual({ via: "existing", tester: false });
    const boss = await completeConnect("c", "v", deps("boss@example.test"));
    expect(boss.access).toEqual({ via: "admin", tester: false });
    const [o] = await (await adminDb()).select().from(orgs).where(eq(orgs.id, boss.created[0]!));
    expect(o!.designPartner).toBe(false);
  });

  it("open mode lets anyone in, as before", async () => {
    process.env.ACCESS_MODE = "open";
    resetEnv();
    const r = await completeConnect("c", "v", deps("anyone@example.test"));
    expect(r.access).toEqual({ via: "open", tester: false });
    process.env.ACCESS_MODE = "invite";
    resetEnv();
  });
});

describe("report a problem", () => {
  it("goes to the queue as user_report with the page path and reference, never the host", async () => {
    expect(orgFromUrl("https://x.test/app/00000000-0000-4000-8000-00000000d3e0/lines/pl%3A310")).toBe("00000000-0000-4000-8000-00000000d3e0");
    expect(orgFromUrl("https://x.test/apps")).toBeNull();
    await submitReport({ url: "https://flowstack.example/app/abc/statements/pl?x=1", requestId: "ref-123", note: "The numbers look off" }, { email: "t@example.test" }, null);
    const [q] = await (await adminDb()).select().from(reviewQueue).where(eq(reviewQueue.kind, "user_report"));
    expect(q!.reason).toContain("/app/abc/statements/pl?x=1");
    expect(q!.reason).toContain("ref-123");
    expect(q!.reason).not.toContain("flowstack.example");
    expect(q!.status).toBe("open");
  });
});
