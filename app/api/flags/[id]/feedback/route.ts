import { z } from "zod";
import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { ANSWERS, flagOrg, submitFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";

const Feedback = z.object({
  // "no" (pre-v1.1 "Not a problem") is accepted for one release and counts as no_app_needed.
  answer: z.enum([...ANSWERS, "no"]),
  app_id: z.string().max(80).optional(),
  app_name: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
});

/** "Is this right?" (BACKEND §10, v1.1 D): yes | already_use_app | no_app_needed | numbers_wrong | not_now. */
export const POST = handle(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Flag not found");
  const orgId = await flagOrg(id);
  if (!orgId) throw new HttpError(404, "Flag not found");
  const u = await requireOrgMember(orgId);
  const b = await body(req, Feedback);
  return submitFeedback({ orgId, flagId: id, userId: u.userId, answer: b.answer, appId: b.app_id, appName: b.app_name, note: b.note });
});
