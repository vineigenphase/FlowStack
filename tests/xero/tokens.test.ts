import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "../helpers/db";
import { adminDb } from "@/lib/db/client";
import { open, seal } from "@/lib/crypto";
import { orgs, xeroConnections } from "@/db/schema";
import { getAccessToken } from "@/lib/xero/tokens";
import { xeroScopes, resetEnv } from "@/lib/env";

process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");

let close: () => Promise<void>;
let connId: string;

beforeAll(async () => {
  const h = await freshDb();
  close = h.close;
  const db = await adminDb();
  const [o] = await db.insert(orgs).values({ name: "T" }).returning();
  const [c] = await db
    .insert(xeroConnections)
    .values({
      orgId: o!.id,
      tenantId: "tenant-1",
      encAccess: await seal("old-access"),
      encRefresh: await seal("refresh-1"),
      expiresAt: new Date(Date.now() - 1000),
    })
    .returning();
  connId = c!.id;
});
afterAll(() => close());

describe("token crypto", () => {
  it("round-trips and never stores plaintext", async () => {
    const s = await seal("secret-token");
    expect(Buffer.from(s).toString("utf8")).not.toContain("secret-token");
    expect(await open(s)).toBe("secret-token");
  });
});

describe("getAccessToken", () => {
  it("refreshes once under the lock when two callers race, and stores the rotated token", async () => {
    let n = 0;
    const refresh = vi.fn(async (rt: string) => {
      expect(rt).toBe("refresh-1");
      n++;
      return { access_token: `access-${n}`, refresh_token: `refresh-${n + 1}`, expires_in: 1800 };
    });
    const [a, b] = await Promise.all([getAccessToken(connId, { refresh }), getAccessToken(connId, { refresh })]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a).toBe("access-1");
    expect(b).toBe("access-1");
    const db = await adminDb();
    const [row] = await db.select().from(xeroConnections).where(eq(xeroConnections.id, connId));
    expect(await open(row!.encRefresh!)).toBe("refresh-2");
  });

  it("force refresh spends the rotated token", async () => {
    const refresh = vi.fn(async (rt: string) => ({ access_token: "forced", refresh_token: rt + "-next", expires_in: 1800 }));
    expect(await getAccessToken(connId, { refresh, force: true })).toBe("forced");
    expect(refresh).toHaveBeenCalledWith("refresh-2");
  });

  it("records the error on the connection when refresh fails", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("invalid_grant");
    });
    await expect(getAccessToken(connId, { refresh, force: true })).rejects.toThrow("invalid_grant");
    const db = await adminDb();
    const [row] = await db.select().from(xeroConnections).where(eq(xeroConnections.id, connId));
    expect(row!.lastError).toContain("invalid_grant");
  });
});

describe("scopes guard", () => {
  it("refuses a write scope", () => {
    process.env.XERO_SCOPES = "openid accounting.transactions";
    resetEnv();
    expect(() => xeroScopes()).toThrow(/non-read/);
    delete process.env.XERO_SCOPES;
    resetEnv();
    expect(xeroScopes().every((s) => s.endsWith(".read") || ["openid", "profile", "email", "offline_access"].includes(s))).toBe(true);
  });
});
