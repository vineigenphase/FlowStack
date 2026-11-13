import { z } from "zod";
import { body, handle, HttpError } from "@/lib/api";
import { createCheckout } from "@/lib/billing";
import { OwnerInput, requireOwner } from "@/lib/billing/owner";
import { PLAN_KEYS } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

const Checkout = z
  .object({
    /** UI-SPEC: monthly | annual (audit_only isn't available yet). */
    planId: z.enum(["monthly", "annual", "audit_only"]).optional(),
    /** Older form: a plans.yaml key. */
    plan: z.string().min(1).max(40).optional(),
    audit: z.boolean().optional(),
    waive_audit: z.boolean().optional(),
  })
  .and(OwnerInput);

/** Stripe Checkout (test mode until prices are decided) → `{ url }` of the hosted page. */
export const POST = handle(async (req: Request) => {
  const b = await body(req, Checkout);
  const plan = b.planId ? PLAN_KEYS[b.planId] : b.plan;
  if (!plan) throw new HttpError(422, b.planId === "audit_only" ? "Audit only isn't available yet" : "Choose a plan");
  const { owner, email } = await requireOwner(b);
  return createCheckout({ owner, plan, audit: b.audit, waiveAudit: b.waive_audit, email });
});
