import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { Resolution, resolveItem } from "@/lib/queue/resolve";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, { params }: Params<{ id: string }>) => {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Queue item not found");
  return resolveItem(id, admin.email, await body(req, Resolution));
});
