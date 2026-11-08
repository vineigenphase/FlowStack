import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { respondToProposal } from "@/lib/firms";

export const dynamic = "force-dynamic";

/** The client accepts the fixes they ticked. Public: the unguessable link is the key. */
export const POST = handle(async (req: Request, { params }: Params<{ token: string }>) => {
  const { token } = await params;
  const b = await body(req, z.object({ chosen: z.array(z.number().int().min(1).max(99)).max(50) }));
  const p = await respondToProposal(token, b.chosen);
  return { status: p.status, chosen: p.chosen };
});
