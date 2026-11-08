import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { addFollowup, FollowupInput } from "@/lib/reviews";

export const dynamic = "force-dynamic";

/** The 90-day re-rate of support after go-live. */
export const POST = handle(async (req: Request, { params }: Params<{ org: string; id: string }>) => {
  const { org, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Review not found");
  const u = await requireOrgMember(org);
  return addFollowup(org, u.userId, id, await body(req, FollowupInput));
});
