/** v1.1 A + I: job title asked once; several businesses per user; the plan's connection cap. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { orgMembers, orgs, users, xeroConnections } from "@/db/schema";
import { resetEnv } from "@/lib/env";
import { connectionUse, getMe, isMember, myOrgs, setJobTitle } from "@/lib/me";
import { completeConnect } from "@/lib/auth/connect";

process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");

let close: () => Promise<void>;
let userId: string;
let mine: string;
let theirs: string;

beforeAll(async () => {
  resetEnv();
  const h = await freshDb();
  close = h.close;
  const db = await adminDb();
  userId = (await db.insert(users).values({ email: "fc@example.test" }).returning())[0]!.id;
  mine = (await db.insert(orgs).values({ name: "Mine Ltd" }).returning())[0]!.id;
  theirs = (await db.insert(orgs).values({ name: "Theirs Ltd" }).returning())[0]!.id;
  await db.insert(orgMembers).values({ orgId: mine, userId, role: "owner" });
});
afterAll(() => close());

const fakeDeps = (tenants: { id: string; tenantId: string; tenantName: string }[]) => ({
  exchange: async () => ({ access_token: "a", refresh_token: "r", expires_in: 1800, id_token: "x", scope: "openid", token_type: "Bearer" }),
  verify: async () => ({ email: "fc@example.test", sub: "s", given_name: "Fin", family_name: "Lead" }) as never,
  connections: async () => tenants.map((t) => ({ ...t, tenantType: "ORGANISATION" })) as never,
});

describe("several businesses per user", () => {
  it("job title is asked once and only takes known values", async () => {
    expect((await getMe(userId))!.jobTitle).toBeNull();
    await setJobTitle(userId, "financial_controller");
    expect((await getMe(userId))!.jobTitle).toBe("financial_controller");
    await expect(setJobTitle(userId, "ceo of everything")).rejects.toThrow();
  });

  it("the switcher lists only the user's businesses, and membership is checked", async () => {
    const list = await myOrgs(userId);
    expect(list.map((o) => o.name)).toEqual(["Mine Ltd"]);
    expect(list[0]).toMatchObject({ lastRefresh: null });
    expect(await isMember(userId, mine)).toBe(true);
    expect(await isMember(userId, theirs)).toBe(false);
    expect(await isMember(userId, "not-a-uuid")).toBe(false);
  });

  it("connecting adds every authorised business, up to the plan cap; reconnecting always works", async () => {
    process.env.XERO_CONNECTION_CAP = "2";
    resetEnv();
    const t = (n: number) => ({ id: `c${n}`, tenantId: `00000000-0000-4000-8000-00000000000${n}`, tenantName: `Client ${n}` });
    const first = await completeConnect("code", "v", fakeDeps([t(1), t(2), t(3)]));
    expect(first.created).toHaveLength(2);
    expect(first.capped).toEqual(["Client 3"]);
    expect(await connectionUse()).toEqual({ used: 2, cap: 2, full: true });
    // At the cap, an existing business reconnects fine.
    const again = await completeConnect("code", "v", fakeDeps([t(1)]));
    expect(again.created).toHaveLength(0);
    expect(again.orgIds).toHaveLength(1);
    expect(again.capped).toEqual([]);
    const db = await adminDb();
    expect(await db.select().from(xeroConnections).where(eq(xeroConnections.tenantId, t(3).tenantId))).toHaveLength(0);
    expect((await myOrgs(userId)).map((o) => o.name)).toEqual(["Client 1", "Client 2", "Mine Ltd"]);
    delete process.env.XERO_CONNECTION_CAP;
    resetEnv();
  });
});
