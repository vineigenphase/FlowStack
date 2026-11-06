import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { RefreshBusyError, runRefresh } from "@/lib/sync/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Run a refresh inline (dev mode, D10) → { runId, status }. One at a time per org: 409 while one is running. */
export const POST = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  try {
    return await runRefresh(org);
  } catch (e) {
    if (e instanceof RefreshBusyError) throw new HttpError(409, e.message);
    throw e;
  }
});
