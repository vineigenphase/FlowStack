import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { addClient, clientsView, requireFirmMember } from "@/lib/firms";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Params<{ firm: string }>) => {
  const { firm } = await params;
  await requireFirmMember(firm);
  return { clients: await clientsView(firm) };
});

/** Add a client business you've connected yourself. */
export const POST = handle(async (req: Request, { params }: Params<{ firm: string }>) => {
  const { firm } = await params;
  const u = await requireFirmMember(firm);
  const b = await body(req, z.object({ orgId: z.string().uuid() }));
  await addClient(firm, u.userId, b.orgId);
  return { ok: true };
});
