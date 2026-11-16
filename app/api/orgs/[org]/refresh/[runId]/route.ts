import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgReader } from "@/lib/auth/session";
import { refreshRun } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** Progress per step (UI-SPEC §5.3 `RefreshRun`). */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string; runId: string }>) => {
  const { org, runId } = await params;
  await requireOrgReader(org);
  const r = await refreshRun(org, runId);
  if (!r) throw new HttpError(404, "Run not found");
  return r;
});
