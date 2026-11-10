import { z } from "zod";
import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { monthlyView, statementView } from "@/lib/read/views";

export const dynamic = "force-dynamic";

/** `kind=pl|bs|cf`. `?months=12` returns the monthly series instead (v1.1 B); the default stays the latest period. */
export const GET = handle(async (req: Request, { params }: Params<{ org: string; kind: string }>) => {
  const { org, kind } = await params;
  await requireOrgMember(org);
  const k = z.enum(["pl", "bs", "cf"]).parse(kind);
  const months = z.coerce.number().int().min(1).max(12).optional().parse(new URL(req.url).searchParams.get("months") ?? undefined);
  const s = months ? await monthlyView(org, k, months) : await statementView(org, k);
  if (!s) throw new HttpError(404, "No statements yet — run a refresh");
  return s;
});
