import { z } from "zod";
import { body, handle } from "@/lib/api";
import { joinWaitlist } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const Join = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(160),
  role: z.enum(["fd", "financial_controller", "finance_manager", "head_of_finance", "accountant_bookkeeper", "other"]),
  industry: z.enum(["ecommerce", "saas", "other"]),
  consent: z.literal(true, { message: "Tick the box to agree we can email you" }),
});

/** Waitlist (UI-SPEC §5.1). A repeat email gets the same answer, so the form never reveals who signed up. */
export const POST = handle(async (req: Request) => {
  const b = await body(req, Join);
  await joinWaitlist(b);
  return { ok: true as const };
});
