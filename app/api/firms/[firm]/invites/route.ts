import { handle, type Params } from "@/lib/api";
import { env } from "@/lib/env";
import { createInvite, INVITE_DAYS, requireFirmMember } from "@/lib/firms";

export const dynamic = "force-dynamic";

/** A single-use join link for a colleague, valid for INVITE_DAYS days. */
export const POST = handle(async (_req: Request, { params }: Params<{ firm: string }>) => {
  const { firm } = await params;
  const u = await requireFirmMember(firm);
  const i = await createInvite(firm, u.userId);
  return { url: `${env().APP_URL.replace(/\/$/, "")}/api/join/${i.token}`, days: INVITE_DAYS };
});
