import { handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { subscriptionOf } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** The business's plan (UI-SPEC §5.15 `Subscription`). Status only: card details never reach us. */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  return subscriptionOf(org);
});
