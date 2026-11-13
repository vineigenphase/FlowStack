import { handle, HttpError, type Params } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { isMember } from "@/lib/me";
import { dossier } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/**
 * App dossier (UI-SPEC §5.8 `AppDossier`). Public; `?org=` (a business the signed-in user belongs to) marks the
 * integrations with apps that business already uses.
 */
export const GET = handle(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const org = new URL(req.url).searchParams.get("org");
  const s = await getSession();
  const orgId = org && s.userId && (await isMember(s.userId, org)) ? org : undefined;
  const a = await dossier(id, orgId);
  if (!a) throw new HttpError(404, "App not found");
  return a;
});
