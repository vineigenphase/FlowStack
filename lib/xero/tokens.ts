/**
 * Access tokens per connection. Refresh tokens rotate on every use, so a refresh runs under a
 * Postgres advisory lock per connection: two requests never spend the same refresh token.
 */
import { eq, sql } from "drizzle-orm";
import { xeroConnections } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { open, seal } from "@/lib/crypto";
import { refreshTokens } from "./oauth";
import type { TokenSet } from "./schemas";

const SKEW_MS = 60_000;

export async function storeTokens(connectionId: string, t: TokenSet) {
  const db = await adminDb();
  await db
    .update(xeroConnections)
    .set({
      encAccess: await seal(t.access_token),
      encRefresh: await seal(t.refresh_token),
      expiresAt: new Date(Date.now() + t.expires_in * 1000),
      ...(t.scope ? { scopes: t.scope.split(" ") } : {}),
      status: "active",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(xeroConnections.id, connectionId));
}

export async function getAccessToken(
  connectionId: string,
  opts: { force?: boolean; refresh?: typeof refreshTokens } = {},
): Promise<string> {
  const db = await adminDb();
  const doRefresh = opts.refresh ?? refreshTokens;
  try {
    return await refreshUnderLock(connectionId, Boolean(opts.force), doRefresh);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200);
    await db.update(xeroConnections).set({ lastError: msg, updatedAt: new Date() }).where(eq(xeroConnections.id, connectionId));
    throw e;
  }
}

async function refreshUnderLock(connectionId: string, force: boolean, doRefresh: typeof refreshTokens): Promise<string> {
  const db = await adminDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${connectionId}))`);
    const [c] = await tx.select().from(xeroConnections).where(eq(xeroConnections.id, connectionId));
    if (!c || c.status === "revoked" || !c.encRefresh) throw new Error("Xero connection is not active");
    const fresh = c.expiresAt && c.expiresAt.getTime() - Date.now() > SKEW_MS;
    if (fresh && !force && c.encAccess) return open(c.encAccess);

    const t = await doRefresh(await open(c.encRefresh));
    await tx
      .update(xeroConnections)
      .set({
        encAccess: await seal(t.access_token),
        encRefresh: await seal(t.refresh_token),
        expiresAt: new Date(Date.now() + t.expires_in * 1000),
        status: "active",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(xeroConnections.id, connectionId));
    return t.access_token;
  });
}
