import { handle, HttpError, type Params } from "@/lib/api";
import { removeClient, requireFirmMember } from "@/lib/firms";

export const dynamic = "force-dynamic";

/** Stop looking after a client in this practice (their own access and data are untouched). */
export const DELETE = handle(async (_req: Request, { params }: Params<{ firm: string; org: string }>) => {
  const { firm, org } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(org)) throw new HttpError(404, "Client not found");
  const u = await requireFirmMember(firm);
  await removeClient(firm, u.userId, org);
  return { ok: true };
});
