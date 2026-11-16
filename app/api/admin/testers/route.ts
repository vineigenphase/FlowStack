import { z } from "zod";
import { body, handle } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { approveEmail, createCode, testersView } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Testers (NEXT-STEPS P0.5): the waitlist with approvals, and invite codes. Admins only. */
export const GET = handle(async () => {
  await requireAdmin();
  return testersView();
});

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), email: z.string().trim().email() }),
  z.object({
    action: z.literal("code"),
    note: z.string().trim().max(200).optional(),
    maxUses: z.number().int().min(1).max(5).default(1), // the Starter plan connects 5 businesses in all
    expiresDays: z.number().int().min(1).max(90).optional(),
  }),
]);

export const POST = handle(async (req: Request) => {
  const u = await requireAdmin();
  const b = await body(req, Action);
  if (b.action === "approve") return approveEmail(b.email, u.email || u.userId);
  return createCode({ by: u.email || u.userId, note: b.note, maxUses: b.maxUses, expiresDays: b.expiresDays });
});
