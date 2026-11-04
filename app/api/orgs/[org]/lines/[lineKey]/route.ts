import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { lineView } from "@/lib/read/views";

export const dynamic = "force-dynamic";

/** Evidence, cause, recommendations and detected apps for one line (e.g. pl:477). */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string; lineKey: string }>) => {
  const { org, lineKey } = await params;
  await requireOrgMember(org);
  const l = await lineView(org, decodeURIComponent(lineKey));
  if (!l) throw new HttpError(404, "Line not found");
  return l;
});
