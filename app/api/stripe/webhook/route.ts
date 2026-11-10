import { handle } from "@/lib/api";
import { handleWebhook } from "@/lib/billing";

export const dynamic = "force-dynamic";

/** Stripe → us. The signature is checked against the raw body, so read it as text. */
export const POST = handle(async (req: Request) => handleWebhook(await req.text(), req.headers.get("stripe-signature")));
