import { after } from "next/server";
import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { executeRefresh, RefreshBusyError, startRefresh } from "@/lib/sync/refresh";
import { runOf } from "@/lib/api/contract";
import { log } from "@/lib/log";
import { errorText } from "@/lib/sync/error-text";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Start a refresh (NEXT-STEPS P0.3) → UI-SPEC `RefreshRun` with status "running", at once. The steps run after the
 * response (Next `after`, kept alive on Vercel up to maxDuration); poll GET /refresh/:runId for progress.
 * One at a time per org: 409 REFRESH_IN_PROGRESS while one is running. `runId` is kept for older components.
 */
export const POST = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  let run;
  try {
    run = await startRefresh(org);
  } catch (e) {
    if (e instanceof RefreshBusyError) throw new HttpError(409, e.message, undefined, "REFRESH_IN_PROGRESS");
    throw e;
  }
  after(async () => {
    try {
      await executeRefresh(org, run);
    } catch (e) {
      log.error({ orgId: org, runId: run.id, err: { message: errorText(e) } }, "refresh failed");
    }
  });
  return { ...runOf(run), runId: run.id };
});
