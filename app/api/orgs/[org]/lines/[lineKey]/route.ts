import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgReader } from "@/lib/auth/session";
import { lineDetail } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** Evidence, cause, feedback and ranked apps for one line, e.g. pl:477 (UI-SPEC §5.7 `LineDetail`). */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string; lineKey: string }>) => {
  const { org, lineKey } = await params;
  await requireOrgReader(org);
  const l = await lineDetail(org, decodeURIComponent(lineKey));
  if (!l) throw new HttpError(404, "Line not found");
  return l;
});
