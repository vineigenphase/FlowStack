import { body, handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { orgQuotes, QuoteInput, requestQuotes } from "@/lib/quotes";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  return { quotes: await orgQuotes(org) };
});

/** Ask up to three vendors for a quote. Only the situation is sent, never figures. */
export const POST = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const u = await requireOrgMember(org);
  return requestQuotes(org, u.userId, await body(req, QuoteInput));
});
