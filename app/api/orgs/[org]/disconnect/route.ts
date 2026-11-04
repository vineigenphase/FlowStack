import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { disconnectOrg } from "@/lib/auth/connect";

/** Revoke our access and delete this org's tokens immediately. */
export const POST = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const m = await requireOrgMember(org);
  if (m.role !== "owner" && !m.isAdmin) throw new HttpError(403, "Only the owner can disconnect");
  return disconnectOrg(org);
});
