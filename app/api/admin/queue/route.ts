import { z } from "zod";
import { handle } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { listQueue } from "@/lib/queue/resolve";

export const dynamic = "force-dynamic";

const Query = z.object({
  kind: z.string().optional(),
  status: z.enum(["open", "done", "dismissed"]).default("open"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** Open items, oldest first, filterable by kind. */
export const GET = handle(async (req: Request) => {
  await requireAdmin();
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const items = await listQueue(q);
  return { count: items.length, items };
});
