import { handle } from "@/lib/api";
import { requireDevTools } from "@/lib/rank/v2/dev";
import { queueSummary } from "@/lib/dev/tools";

export const dynamic = "force-dynamic";

/** ENGINE-V2 §2.2: open review items by kind and priority + the 5 oldest, for the dev rail (polled every 30 s). ?org= narrows to one business. */
export const GET = handle(async (req: Request) => {
  await requireDevTools();
  const org = new URL(req.url).searchParams.get("org");
  return queueSummary(org && /^[0-9a-f-]{36}$/.test(org) ? org : null);
});
