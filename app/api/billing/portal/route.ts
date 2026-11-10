import { body, handle } from "@/lib/api";
import { createPortal } from "@/lib/billing";
import { OwnerInput, requireOwner } from "@/lib/billing/owner";

export const dynamic = "force-dynamic";

/** Stripe Customer Portal: change card, see invoices, cancel. */
export const POST = handle(async (req: Request) => {
  const { owner } = await requireOwner(await body(req, OwnerInput));
  return createPortal(owner);
});
