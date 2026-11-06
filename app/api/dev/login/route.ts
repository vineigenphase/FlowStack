import { eq } from "drizzle-orm";
import { handle, HttpError } from "@/lib/api";
import { env, adminEmails } from "@/lib/env";
import { adminDb } from "@/lib/db/client";
import { orgMembers, orgs, users } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Dev mode only (XERO_MODE=fixtures, not production): sign in as the first ADMIN_EMAILS user and
 * join every sample org, so the API can be exercised without a Xero app.
 */
export const GET = handle(async (req: Request) => {
  const e = env();
  if (e.NODE_ENV === "production" || e.XERO_MODE !== "fixtures") throw new HttpError(404, "Not found");
  const email = adminEmails()[0] ?? "dev@localhost";
  const db = await adminDb();
  const [u] = await db
    .insert(users)
    .values({ email, name: "Dev admin", isAdmin: true })
    .onConflictDoUpdate({ target: users.email, set: { isAdmin: true } })
    .returning();
  const sampleOrgs = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.sample, true));
  for (const o of sampleOrgs) {
    await db.insert(orgMembers).values({ orgId: o.id, userId: u!.id, role: "owner" }).onConflictDoNothing();
  }
  const s = await getSession();
  s.userId = u!.id;
  s.email = u!.email;
  s.isAdmin = true;
  await s.save();
  // ?next=/path (same-site paths only) sends the browser on; without it, JSON for scripts.
  const next = new URL(req.url).searchParams.get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return Response.redirect(new URL(next, req.url), 303);
  return { ok: true, user: email, orgs: sampleOrgs.map((o) => o.id) };
});
