import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { summaryView } from "@/lib/read/views";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  const s = await summaryView(org);
  if (!s) throw new HttpError(404, "Org not found");
  return s;
});
