import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { runView } from "@/lib/read/views";

export const dynamic = "force-dynamic";

/** Progress per step. */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string; runId: string }>) => {
  const { org, runId } = await params;
  await requireOrgMember(org);
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new HttpError(404, "Run not found");
  const r = await runView(org, runId);
  if (!r) throw new HttpError(404, "Run not found");
  return r;
});
