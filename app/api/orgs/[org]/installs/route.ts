import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { afterInstallView, markInstalled } from "@/lib/checkins";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const Install = z.object({
  appId: z.string().min(1).max(64),
  lineKey: z.string().max(200).nullish(),
  installedOn: day.optional(),
  renewalOn: day.nullish(),
});

/** Apps the business started using, with their check-ins (CLAUDE.md §7.6). */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  return { installs: await afterInstallView(org) };
});

/** "We've started using it": records the line's baseline and schedules day 7/30/90 (+ renewal −60). */
export const POST = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const u = await requireOrgMember(org);
  const b = await body(req, Install);
  return markInstalled(org, { ...b, userId: u.userId });
});
