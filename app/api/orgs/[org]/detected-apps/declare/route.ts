import { z } from "zod";
import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { declareApp } from "@/lib/detect/status";
import { detectedAppsView } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** "Add an app you pay for outside Xero" (UI-SPEC §5.9) → state `declared`, which counts as coverage. */
export const POST = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const u = await requireOrgMember(org);
  const b = await body(req, z.object({ appId: z.string().max(80).optional(), name: z.string().trim().max(120).optional() }));
  if (!b.appId && !b.name) throw new HttpError(422, "Pick the app, or type its name");
  await declareApp(org, u.userId, b);
  return detectedAppsView(org);
});
