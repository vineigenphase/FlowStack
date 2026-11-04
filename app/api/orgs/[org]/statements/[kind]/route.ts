import { z } from "zod";
import { handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { statementView } from "@/lib/read/views";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Params<{ org: string; kind: string }>) => {
  const { org, kind } = await params;
  await requireOrgMember(org);
  const k = z.enum(["pl", "bs", "cf"]).parse(kind);
  const s = await statementView(org, k);
  if (!s) throw new HttpError(404, "No statements yet — run a refresh");
  return s;
});
