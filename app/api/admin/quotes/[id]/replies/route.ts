import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { addReply, ReplyInput } from "@/lib/quotes";

export const dynamic = "force-dynamic";

/** Enter a vendor's reply to a quote request (our team, from the vendor's email). */
export const POST = handle(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Quote request not found");
  const u = await requireAdmin();
  return addReply(id, await body(req, ReplyInput), u.email || u.userId);
});
