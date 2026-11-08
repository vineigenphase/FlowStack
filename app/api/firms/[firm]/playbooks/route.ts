import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { getPlaybooks, requireFirmMember, setPlaybook } from "@/lib/firms";
import { INDUSTRIES } from "@/lib/orgs/settings";

export const dynamic = "force-dynamic";

const Set_ = z.object({
  industry: z.enum(INDUSTRIES.map((i) => i.key) as [string, ...string[]]),
  jobKey: z.string().min(1).max(64),
  appId: z.string().min(1).max(64).nullable(),
});

export const GET = handle(async (_req: Request, { params }: Params<{ firm: string }>) => {
  const { firm } = await params;
  await requireFirmMember(firm);
  return { playbooks: await getPlaybooks(firm) };
});

/** Set or clear the firm's standard app for one job in one industry. */
export const PUT = handle(async (req: Request, { params }: Params<{ firm: string }>) => {
  const { firm } = await params;
  const u = await requireFirmMember(firm);
  const b = await body(req, Set_);
  await setPlaybook(firm, u.userId, b.industry, b.jobKey, b.appId);
  return { ok: true };
});
