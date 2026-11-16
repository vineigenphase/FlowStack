/**
 * The work behind /api/auth/xero/callback, kept out of the route so it can be tested.
 * code → tokens → verified identity → tenants → user/org/connection rows (tokens encrypted).
 */
import { randomUUID } from "node:crypto";
import { and, count, eq, ne } from "drizzle-orm";
import { orgMembers, orgs, users, xeroConnections } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { adminEmails, env } from "@/lib/env";
import { seal } from "@/lib/crypto";
import {
  deleteConnection,
  exchangeCode,
  listConnections,
  revokeRefreshToken,
  verifyIdToken,
  type XeroIdentity,
} from "@/lib/xero/oauth";
import { getAccessToken } from "@/lib/xero/tokens";
import { open } from "@/lib/crypto";
import { AccessDeniedError, checkAccess, type Access } from "@/lib/access";

export type ConnectDeps = {
  exchange?: typeof exchangeCode;
  verify?: (idToken: string) => Promise<XeroIdentity>;
  connections?: typeof listConnections;
  /** NEXT-STEPS P0.5: the invite code typed on /connect (ACCESS_MODE=invite). */
  invite?: string | null;
  /** Undo a refused connect at Xero (tests pass a stub). */
  undo?: (accessToken: string, refreshToken: string, connectionIds: string[]) => Promise<void>;
};

/** A refused person authorised our app at Xero: remove those connections so they don't count against the plan cap. */
async function undoAtXero(accessToken: string, refreshToken: string, connectionIds: string[]) {
  for (const id of connectionIds) await deleteConnection(accessToken, id).catch(() => {});
  await revokeRefreshToken(refreshToken).catch(() => {});
}

export async function completeConnect(code: string, verifier: string, deps: ConnectDeps = {}) {
  const tokens = await (deps.exchange ?? exchangeCode)(code, verifier);
  if (!tokens.id_token) throw new Error("Xero did not return an id_token (is the openid scope requested?)");
  const who = await (deps.verify ?? verifyIdToken)(tokens.id_token);
  const tenants = await (deps.connections ?? listConnections)(tokens.access_token);
  if (!tenants.length) throw new Error("No Xero organisation was authorised");

  const db = await adminDb();
  const email = who.email.toLowerCase();
  const name = [who.given_name, who.family_name].filter(Boolean).join(" ") || null;
  const isAdmin = adminEmails().includes(email);
  const grantKey = randomUUID();
  const encAccess = await seal(tokens.access_token);
  const encRefresh = await seal(tokens.refresh_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const scopes = tokens.scope?.split(" ") ?? [];

  const cap = env().XERO_CONNECTION_CAP;
  try {
    return await connectRows();
  } catch (e) {
    if (e instanceof AccessDeniedError) await (deps.undo ?? undoAtXero)(tokens.access_token, tokens.refresh_token, tenants.map((t) => t.id));
    throw e;
  }

  function connectRows() {
  return db.transaction(async (tx) => {
    // v1.1 I: the plan cap (Starter 5) counts every business on our app, not per user.
    // NEXT-STEPS P0.5: invite-only gate, decided before any row is written (a refusal rolls everything back).
    const access: Access = await checkAccess(tx as unknown as Parameters<typeof checkAccess>[0], email, deps.invite);
    const [c0] = await tx.select({ n: count() }).from(xeroConnections).where(ne(xeroConnections.status, "revoked"));
    let used = Number(c0?.n ?? 0);
    const capped: string[] = [];
    const [user] = await tx
      .insert(users)
      .values({ email, name, xeroUserId: who.xero_userid ?? who.sub, isAdmin })
      .onConflictDoUpdate({ target: users.email, set: { name, xeroUserId: who.xero_userid ?? who.sub, isAdmin } })
      .returning();

    const orgIds: string[] = [];
    const created: string[] = [];
    for (const t of tenants) {
      const [existing] = await tx.select().from(xeroConnections).where(eq(xeroConnections.tenantId, t.tenantId));
      let orgId: string;
      if (existing) {
        orgId = existing.orgId;
        await tx
          .update(xeroConnections)
          .set({ connectionId: t.id, grantKey, encAccess, encRefresh, expiresAt, scopes, status: "active", lastError: null, updatedAt: new Date() })
          .where(eq(xeroConnections.id, existing.id));
      } else if (used >= cap) {
        // Over the cap: don't take on a new business. Reconnecting one we already have always works.
        capped.push(t.tenantName ?? "Xero organisation");
        continue;
      } else {
        used++;
        const [o] = await tx.insert(orgs).values({ name: t.tenantName ?? "Xero organisation", designPartner: access.tester }).returning();
        orgId = o!.id;
        created.push(orgId);
        await tx.insert(xeroConnections).values({ orgId, tenantId: t.tenantId, connectionId: t.id, grantKey, encAccess, encRefresh, expiresAt, scopes });
      }
      await tx.insert(orgMembers).values({ orgId, userId: user!.id, role: existing ? "member" : "owner" }).onConflictDoNothing();
      orgIds.push(orgId);
    }
    return { user: user!, orgIds, created, capped, access };
  });
  }
}

/**
 * Disconnect one org: remove our access to that tenant at Xero, delete its tokens immediately.
 * The refresh token is revoked only when no other active connection shares the grant.
 */
export async function disconnectOrg(orgId: string, deps: { fetchImpl?: typeof fetch } = {}) {
  const db = await adminDb();
  const [c] = await db
    .select()
    .from(xeroConnections)
    .where(and(eq(xeroConnections.orgId, orgId), ne(xeroConnections.status, "revoked")));
  if (!c) return { disconnected: false };

  try {
    const access = await getAccessToken(c.id);
    if (c.connectionId) await deleteConnection(access, c.connectionId, deps.fetchImpl);
    const siblings = await db
      .select({ id: xeroConnections.id })
      .from(xeroConnections)
      .where(and(eq(xeroConnections.grantKey, c.grantKey), ne(xeroConnections.id, c.id), eq(xeroConnections.status, "active")));
    if (!siblings.length && c.encRefresh) await revokeRefreshToken(await open(c.encRefresh), deps.fetchImpl);
  } catch {
    // Xero-side cleanup is best effort; our copy of the tokens is deleted regardless.
  }
  await db
    .update(xeroConnections)
    .set({ encAccess: null, encRefresh: null, expiresAt: null, status: "revoked", updatedAt: new Date() })
    .where(eq(xeroConnections.id, c.id));
  return { disconnected: true };
}
