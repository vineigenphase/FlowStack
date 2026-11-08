import { body, handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { myReviews, reviewable, ReviewInput, submitReview } from "@/lib/reviews";

export const dynamic = "force-dynamic";

/** Apps this business can review (2+ months of bills) and the reviews it has written. */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  return { reviewable: await reviewable(org), mine: await myReviews(org) };
});

/** Write or edit a review. It's checked by a person before it's public. */
export const POST = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const u = await requireOrgMember(org);
  return submitReview(org, u.userId, await body(req, ReviewInput));
});
