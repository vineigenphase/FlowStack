import { handle } from "@/lib/api";
import { requireCron } from "@/lib/cron";
import { markStale } from "@/lib/crawl";

export const dynamic = "force-dynamic";

/** 02:17 daily: facts not confirmed for 90 days → stale + queue. */
export const GET = handle(async (req: Request) => {
  requireCron(req);
  return { stale: await markStale() };
});
