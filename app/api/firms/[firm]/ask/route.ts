import { z } from "zod";
import { eq } from "drizzle-orm";
import { body, handle, type Params } from "@/lib/api";
import { requireFirmMember } from "@/lib/firms";
import { adminDb } from "@/lib/db/client";
import { firmOrgs, orgs } from "@/db/schema";
import { askAcross } from "@/lib/llm/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Ask across all clients": the same question matched against every client's stack (rules only). */
export const POST = handle(async (req: Request, { params }: Params<{ firm: string }>) => {
  const { firm } = await params;
  await requireFirmMember(firm);
  const b = await body(req, z.object({ question: z.string().trim().min(3).max(500) }));
  const db = await adminDb();
  const clients = await db.select({ orgId: orgs.id, name: orgs.name }).from(firmOrgs).innerJoin(orgs, eq(orgs.id, firmOrgs.orgId)).where(eq(firmOrgs.firmId, firm));
  return askAcross(clients, b.question);
});
