import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { RefreshBusyError, runRefresh } from "@/lib/sync/refresh";
import { refreshRun } from "@/lib/api/contract";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Run a refresh (inline for now, D10) → UI-SPEC `RefreshRun`, plus `runId` for the older components.
 * One at a time per org: 409 REFRESH_IN_PROGRESS while one is running.
 */
export const POST = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  try {
    const { runId } = await runRefresh(org);
    return { ...(await refreshRun(org, runId)), runId };
  } catch (e) {
    if (e instanceof RefreshBusyError) throw new HttpError(409, e.message, undefined, "REFRESH_IN_PROGRESS");
    throw e;
  }
});
