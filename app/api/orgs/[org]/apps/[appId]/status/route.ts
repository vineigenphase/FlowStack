import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { answerAppStatus } from "@/lib/detect/status";

export const dynamic = "force-dynamic";

const Answer = z.discriminatedUnion("answer", [
  z.object({ answer: z.literal("still_use") }),
  z.object({ answer: z.literal("stopped") }),
  z.object({ answer: z.literal("moved"), replaced_by_app_id: z.string().min(1).max(80) }),
  z.object({ answer: z.literal("replacing"), old_app_id: z.string().min(1).max(80) }),
  z.object({ answer: z.literal("both") }),
]);

/** BACKEND §6.1 (v1.1 C): "Do you still use it?" and "Is X replacing Y?". Asked in the app only. */
export const POST = handle(async (req: Request, { params }: Params<{ org: string; appId: string }>) => {
  const { org, appId } = await params;
  const u = await requireOrgMember(org);
  const b = await body(req, Answer);
  const input =
    b.answer === "moved" ? { answer: "moved" as const, replacedBy: b.replaced_by_app_id } : b.answer === "replacing" ? { answer: "replacing" as const, old: b.old_app_id } : { answer: b.answer };
  return answerAppStatus(org, appId, u.userId, input);
});
