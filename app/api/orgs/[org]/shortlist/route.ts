import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { addToShortlist, removeFromShortlist, shortlistOf } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

const Item = z.object({ appId: z.string().min(1).max(80), lineKey: z.string().max(120).nullable().optional() });

/** Shortlist (UI-SPEC §5.11). Prices come from verified facts only; unknown ones stay null. */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  return shortlistOf(org);
});

export const POST = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const u = await requireOrgMember(org);
  const b = await body(req, Item);
  return addToShortlist(org, u.userId, b.appId, b.lineKey);
});

/** Without lineKey: removes the app from every line. */
export const DELETE = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  const b = await body(req, Item);
  return removeFromShortlist(org, b.appId, b.lineKey);
});
