import { handle } from "@/lib/api";
import { getSession, requireUser } from "@/lib/auth/session";
import { myOrgs } from "@/lib/me";

export const dynamic = "force-dynamic";

/** The user's businesses: name, last refresh, £ at stake (v1.1 I). */
export const GET = handle(async () => {
  const u = await requireUser();
  const s = await getSession();
  return { activeOrgId: s.activeOrgId ?? null, orgs: await myOrgs(u.userId) };
});
