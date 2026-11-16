import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { guestOn, requireOrgMember, requireOrgReader } from "@/lib/auth/session";
import { addToShortlist, removeFromShortlist, shortlistOf, shortlistItems } from "@/lib/api/contract";
import { guestShortlist, guestShortlistAdd, guestShortlistRemove } from "@/lib/demo";

export const dynamic = "force-dynamic";

const Item = z.object({ appId: z.string().min(1).max(80), lineKey: z.string().max(120).nullable().optional() });

/** Shortlist (UI-SPEC §5.11). Prices come from verified facts only. A /demo guest gets their own 24-hour list. */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgReader(org);
  const g = await guestOn(org);
  return g ? shortlistItems(org, await guestShortlist(g)) : shortlistOf(org);
});

export const POST = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const b = await body(req, Item);
  const g = await guestOn(org);
  if (g) return shortlistItems(org, await guestShortlistAdd(g, org, b.appId, b.lineKey));
  const u = await requireOrgMember(org);
  return addToShortlist(org, u.userId, b.appId, b.lineKey);
});

/** Without lineKey: removes the app from every line. */
export const DELETE = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const b = await body(req, Item);
  const g = await guestOn(org);
  if (g) return shortlistItems(org, await guestShortlistRemove(g, b.appId));
  await requireOrgMember(org);
  return removeFromShortlist(org, b.appId, b.lineKey);
});
