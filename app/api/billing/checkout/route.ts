import { z } from "zod";
import { body, handle } from "@/lib/api";
import { createCheckout } from "@/lib/billing";
import { OwnerInput, requireOwner } from "@/lib/billing/owner";

export const dynamic = "force-dynamic";

const Checkout = z.object({ plan: z.string().min(1).max(40), audit: z.boolean().optional(), waive_audit: z.boolean().optional() }).and(OwnerInput);

/** Stripe Checkout (test mode until prices are decided). Returns the hosted page to send the user to. */
export const POST = handle(async (req: Request) => {
  const b = await body(req, Checkout);
  const { owner, email } = await requireOwner(b);
  return createCheckout({ owner, plan: b.plan, audit: b.audit, waiveAudit: b.waive_audit, email });
});
