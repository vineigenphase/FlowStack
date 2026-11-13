import { z } from "zod";
import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { statement } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** `kind=pl|bs|cf` (UI-SPEC §5.6 `Statement`). `?months=12` adds monthly columns (`months` + each line's `monthly`). */
export const GET = handle(async (req: Request, { params }: Params<{ org: string; kind: string }>) => {
  const { org, kind } = await params;
  await requireOrgMember(org);
  const k = z.enum(["pl", "bs", "cf"]).parse(kind);
  const months = z.coerce.number().int().min(1).max(12).optional().parse(new URL(req.url).searchParams.get("months") ?? undefined);
  const s = await statement(org, k, { months });
  if (!s) throw new HttpError(404, "No statements yet. Run a refresh first.");
  return s;
});
