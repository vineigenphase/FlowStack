import { z } from "zod";
import { body, handle, HttpError } from "@/lib/api";
import { getSession, requireUser } from "@/lib/auth/session";
import { isMember } from "@/lib/me";
import { me } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/**
 * Switch business (v1.1 I). Only an org the user belongs to; every data route stays scoped by /api/orgs/:org.
 * Returns `Me` (UI-SPEC §8), plus `next` for the components written before it.
 */
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const { orgId } = await body(req, z.object({ orgId: z.string().uuid() }));
  if (!(await isMember(u.userId, orgId))) throw new HttpError(404, "Org not found");
  const s = await getSession();
  s.activeOrgId = orgId;
  await s.save();
  return { ...(await me(u.userId, orgId)), next: `/app/${orgId}` };
});
