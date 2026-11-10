import { z } from "zod";
import { requireOrgMember } from "@/lib/auth/session";
import { requireFirmMember } from "@/lib/firms";
import type { Owner } from "./index";

/** Who pays: one business, or a practice (firm plan). The caller must belong to it. */
export const OwnerInput = z.union([z.object({ orgId: z.string().uuid() }), z.object({ firmId: z.string().uuid() })]);

export async function requireOwner(o: z.infer<typeof OwnerInput>): Promise<{ owner: Owner; email: string }> {
  if ("orgId" in o) {
    const u = await requireOrgMember(o.orgId);
    return { owner: { orgId: o.orgId }, email: u.email };
  }
  const u = await requireFirmMember(o.firmId);
  return { owner: { firmId: o.firmId }, email: (u as { email?: string }).email ?? "" };
}
