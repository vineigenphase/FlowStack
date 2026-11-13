import { handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { detectedAppsView } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** Apps found in the business's spend, with the lifecycle questions waiting (UI-SPEC §5.9). */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  return detectedAppsView(org);
});
