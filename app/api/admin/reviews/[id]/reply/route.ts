import { z } from "zod";
import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { addVendorReply } from "@/lib/reviews";

export const dynamic = "force-dynamic";

const Reply = z.object({ vendorName: z.string().trim().min(2).max(120), body: z.string().trim().min(10).max(3000) });

/**
 * Post a vendor's public reply, after our team has confirmed the sender works for the vendor.
 * Replies sit under the review; vendors can't edit, hide or reorder reviews.
 */
export const POST = handle(async (req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Review not found");
  const u = await requireAdmin();
  const b = await body(req, Reply);
  return addVendorReply(id, b.vendorName, b.body, u.email || u.userId);
});
