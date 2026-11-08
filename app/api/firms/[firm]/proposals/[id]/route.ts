import { z } from "zod";
import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireFirmMember, updateProposal } from "@/lib/firms";

export const dynamic = "force-dynamic";

const Patch = z.object({ feeText: z.string().trim().max(500).nullable().optional(), status: z.enum(["sent", "withdrawn"]).optional() });

/** Edit the fee wording, send (makes the share link live for 30 days), or withdraw. */
export const PATCH = handle(async (req: Request, { params }: Params<{ firm: string; id: string }>) => {
  const { firm, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Proposal not found");
  const u = await requireFirmMember(firm);
  return updateProposal(firm, id, u.userId, await body(req, Patch));
});
