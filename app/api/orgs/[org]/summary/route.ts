import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgReader } from "@/lib/auth/session";
import { summary } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** Overview (UI-SPEC §5.5 `Summary`). */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgReader(org);
  const s = await summary(org);
  if (!s) throw new HttpError(404, "Org not found");
  return s;
});
