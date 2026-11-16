import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { and, eq } from "drizzle-orm";
import { firmMembers, firmOrgs, orgMembers, users } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/api";
import { guestReader, type GuestSession, type Reader } from "@/lib/demo";

/** activeOrgId: the business last switched to (v1.1 I). Every data route still checks membership itself. */
export type SessionData = { userId?: string; email?: string; isAdmin?: boolean; activeOrgId?: string } & GuestSession;
export type OAuthState = { verifier?: string; state?: string };

const base = (): Omit<SessionOptions, "cookieName"> => ({
  password: env().SESSION_SECRET,
  cookieOptions: { httpOnly: true, sameSite: "lax", secure: env().NODE_ENV === "production", path: "/" },
});

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), { ...base(), cookieName: "fs_session" });
}

/** Short-lived cookie holding the PKCE verifier and state between /start and /callback. */
export async function getOAuthState() {
  return getIronSession<OAuthState>(await cookies(), { ...base(), cookieName: "fs_oauth", ttl: 600 });
}

export async function requireUser() {
  const s = await getSession();
  if (!s.userId) throw new HttpError(401, "Sign in with Xero first");
  return { userId: s.userId, email: s.email ?? "", isAdmin: Boolean(s.isAdmin) };
}

/** The signed-in user must be a member of this org (checked on the owner connection; RLS scopes the data after). */
export async function requireOrgMember(orgId: string) {
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new HttpError(404, "Org not found");
  const db = await adminDb();
  const [m] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, u.userId)));
  if (m) return { ...u, role: m.role, via: "org" as const };
  // Practice plan: members of a firm that looks after this client can open it too.
  const [f] = await db
    .select({ firmId: firmOrgs.firmId })
    .from(firmOrgs)
    .innerJoin(firmMembers, and(eq(firmMembers.firmId, firmOrgs.firmId), eq(firmMembers.userId, u.userId)))
    .where(eq(firmOrgs.orgId, orgId))
    .limit(1);
  if (f) return { ...u, role: "member" as const, via: "firm" as const };
  if (!u.isAdmin) throw new HttpError(404, "Org not found");
  return { ...u, role: "member" as const, via: "admin" as const };
}

/**
 * Read access (NEXT-STEPS P0.2): a signed-in member, or a /demo guest on the demo business. Use it on pages and GET
 * routes only; every write keeps requireOrgMember, which a guest can never pass (no userId).
 */
export async function requireOrgReader(orgId: string): Promise<Reader & { email: string; isAdmin: boolean }> {
  const s = await getSession();
  if (s.userId) {
    try {
      const m = await requireOrgMember(orgId);
      return { userId: m.userId, guestId: null, guest: false, role: m.role, email: m.email, isAdmin: m.isAdmin };
    } catch (e) {
      // A signed-in user who opened /demo reads the demo business as a guest (their own access is unchanged).
      if (!(e instanceof HttpError) || e.status !== 404 || s.guestOrgId !== orgId) throw e;
    }
  }
  return { ...guestReader(s, orgId), email: "", isAdmin: false };
}

/** The guest id when the visitor is a /demo guest on this org (for routes that keep guest answers apart). */
export async function guestOn(orgId: string): Promise<string | null> {
  const s = await getSession();
  if (s.userId && s.guestOrgId !== orgId) return null;
  if (s.userId && (await isMemberOf(s.userId, orgId))) return null;
  try {
    return guestReader(s, orgId).guestId;
  } catch {
    return null;
  }
}

async function isMemberOf(userId: string, orgId: string) {
  const [m] = await (await adminDb()).select({ r: orgMembers.role }).from(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  return Boolean(m);
}

export async function requireAdmin() {
  const u = await requireUser();
  const db = await adminDb();
  const [row] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, u.userId));
  if (!row?.isAdmin) throw new HttpError(403, "Admins only");
  return u;
}
