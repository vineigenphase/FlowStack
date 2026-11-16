import { z } from "zod";
import { body, handle, HttpError, type Params } from "@/lib/api";
import { guestOn, requireOrgMember } from "@/lib/auth/session";
import { guestFeedback, undoGuestFeedback } from "@/lib/demo";
import { ANSWERS, flagOrg, SUB_REASONS, submitFeedback, undoFeedback } from "@/lib/feedback";
import { lineByFlag } from "@/lib/api/contract";
import type { FeedbackResult } from "@/lib/api/types";

export const dynamic = "force-dynamic";

const Feedback = z
  .object({
    // "no" (pre-v1.1 "Not a problem") is accepted for one release and counts as no_app_needed.
    answer: z.enum([...ANSWERS, "no"]),
    subReason: z.enum(SUB_REASONS).optional(),
    appId: z.string().max(80).optional(),
    appName: z.string().trim().max(120).optional(),
    note: z.string().trim().max(1000).optional(),
    // snake_case, from the components written before UI-SPEC.
    app_id: z.string().max(80).optional(),
    app_name: z.string().trim().max(120).optional(),
  })
  .transform((b) => ({ ...b, appId: b.appId ?? b.app_id, appName: b.appName ?? b.app_name }));

async function orgOf(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Flag not found");
  const orgId = await flagOrg(id);
  if (!orgId) throw new HttpError(404, "Flag not found");
  return orgId;
}

/** "Is this right?" (UI-SPEC §5.7a) → `FeedbackResult`, plus the older fields (flagId, answer, state). */
export const POST = handle(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const orgId = await orgOf(id);
  const b = await body(req, Feedback);
  // A /demo guest: kept 24 hours apart from real answers, never in the false-positive report.
  const g = await guestOn(orgId);
  if (g) return guestFeedback(g, orgId, id, { answer: b.answer, subReason: b.subReason, appId: b.appId, appName: b.appName, note: b.note });
  const user = await requireOrgMember(orgId);
  const out = await submitFeedback({ orgId, flagId: id, userId: user.userId, answer: b.answer, subReason: b.subReason, appId: b.appId, appName: b.appName, note: b.note });
  const line = await lineByFlag(orgId, id);
  const result: FeedbackResult = {
    feedback: {
      id: out.feedbackId,
      answer: out.answer,
      ...(b.subReason && out.answer === "numbers_wrong" ? { subReason: b.subReason } : {}),
      ...(b.appId ? { appId: b.appId } : {}),
      ...(b.appName ? { appName: b.appName } : {}),
      ...(b.note ? { note: b.note } : {}),
      createdAt: out.createdAt.toISOString(),
      by: user.email ?? "",
    },
    line: line!,
    message: out.message,
  };
  return { ...result, flagId: id, answer: out.answer, state: out.state };
});

/** Undo the latest answer (UI-SPEC §5.7a, the 10-second "Undo"). */
export const DELETE = handle(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const orgId = await orgOf(id);
  const g = await guestOn(orgId);
  if (g) return undoGuestFeedback(g, id);
  const user = await requireOrgMember(orgId);
  const out = await undoFeedback({ orgId, flagId: id, userId: user.userId });
  return { line: await lineByFlag(orgId, id), message: out.message, state: out.state };
});
