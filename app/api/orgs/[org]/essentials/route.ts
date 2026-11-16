import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { requireOrgMember, requireOrgReader } from "@/lib/auth/session";
import { essentialsOf, setEssential } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** Every-year essentials for the business's markets (UI-SPEC §5.10). Next due dates stay null until we know them. */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgReader(org);
  return essentialsOf(org);
});

export const PUT = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  const b = await body(req, z.object({ key: z.string().max(80), covered: z.boolean() }));
  return setEssential(org, b.key, b.covered);
});
