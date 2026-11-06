import { handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { runRefresh } from "@/lib/sync/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Run a refresh inline (dev mode, D10) → { runId, status }. */
export const POST = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  return runRefresh(org);
});
