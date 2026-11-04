import { z } from "zod";
import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { flagOrg, submitFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";

const Feedback = z.object({ answer: z.enum(["yes", "no"]), note: z.string().trim().max(1000).optional() });

/** "Is this right?" — "no" marks the line fine for this org and opens a flag_disputed item. */
export const POST = handle(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Flag not found");
  const orgId = await flagOrg(id);
  if (!orgId) throw new HttpError(404, "Flag not found");
  const u = await requireOrgMember(orgId);
  const b = await body(req, Feedback);
  return submitFeedback({ orgId, flagId: id, userId: u.userId, answer: b.answer, note: b.note });
});
