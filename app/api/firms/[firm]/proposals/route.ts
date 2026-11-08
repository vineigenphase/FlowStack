import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { createProposal, firmProposals, requireFirmMember } from "@/lib/firms";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Params<{ firm: string }>) => {
  const { firm } = await params;
  await requireFirmMember(firm);
  return { proposals: await firmProposals(firm) };
});

/** Draft a proposal from a client's numbered fixes. The fee is the firm's to set, in its own words. */
export const POST = handle(async (req: Request, { params }: Params<{ firm: string }>) => {
  const { firm } = await params;
  const u = await requireFirmMember(firm);
  const b = await body(req, z.object({ orgId: z.string().uuid(), feeText: z.string().trim().max(500).nullish() }));
  return createProposal(firm, b.orgId, u.userId, b.feeText ?? null);
});
