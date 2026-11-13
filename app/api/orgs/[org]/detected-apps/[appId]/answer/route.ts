import { z } from "zod";
import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { answerAppStatus, type StatusInput } from "@/lib/detect/status";
import { detectedAppsView } from "@/lib/api/contract";
import { enqueue } from "@/lib/queue/enqueue";

export const dynamic = "force-dynamic";

const Answer = z.object({
  answer: z.enum(["still_using", "moved_to", "stopped", "is_replacement", "not_replacement"]),
  movedToAppId: z.string().max(80).optional(),
  movedToName: z.string().trim().max(120).optional(),
  /** For the replacement questions: the new app (LifecycleQuestion.replacementAppId). */
  replacementAppId: z.string().max(80).optional(),
});

/**
 * Lifecycle answers (UI-SPEC §5.9). `:appId` is the app the question is about: the lapsing app, or for
 * "Is <new> replacing <old>?" the old one, with the new one in `replacementAppId`.
 */
export const POST = handle(async (req: Request, { params }: Params<{ org: string; appId: string }>) => {
  const { org, appId } = await params;
  const u = await requireOrgMember(org);
  const b = await body(req, Answer);
  let input: StatusInput;
  if (b.answer === "still_using") input = { answer: "still_use" };
  else if (b.answer === "stopped") input = { answer: "stopped" };
  else if (b.answer === "moved_to") {
    if (!b.movedToAppId) {
      // An app we don't list: our team adds it; nothing changes in the meantime.
      if (!b.movedToName) throw new HttpError(422, "Pick the app you moved to, or type its name");
      await enqueue({ kind: "fingerprint_check", orgId: org, ref: { org_id: org, from_app: appId, declared_name: b.movedToName }, reason: `The business says it moved from ${appId} to "${b.movedToName}", which isn't in our catalogue. Add it, with its supplier names.` });
      return detectedAppsView(org);
    }
    input = { answer: "moved", replacedBy: b.movedToAppId };
  } else {
    if (!b.replacementAppId) throw new HttpError(422, "replacementAppId is required for a replacement answer");
    // Stored on the new app, as the summary page's question does.
    input = b.answer === "is_replacement" ? { answer: "replacing", old: appId } : { answer: "both" };
    await answerAppStatus(org, b.replacementAppId, u.userId, input);
    return detectedAppsView(org);
  }
  await answerAppStatus(org, appId, u.userId, input);
  return detectedAppsView(org);
});
