import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { withdrawReview } from "@/lib/reviews";

export const dynamic = "force-dynamic";

/** Withdraw a review (it stops being public; the audit trail keeps the history). */
export const DELETE = handle(async (_req: Request, { params }: Params<{ org: string; id: string }>) => {
  const { org, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Review not found");
  const u = await requireOrgMember(org);
  return withdrawReview(org, u.userId, id);
});
