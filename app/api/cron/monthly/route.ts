import { handle } from "@/lib/api";
import { requireCron } from "@/lib/cron";
import { crawlAll } from "@/lib/crawl";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 03:41 on the 1st: crawl the catalogue. */
export const GET = handle(async (req: Request) => {
  requireCron(req);
  const out = await crawlAll();
  return { apps: out.length, found: out.reduce((s, a) => s + a.found.length, 0), queued: out.reduce((s, a) => s + a.queued, 0) };
});
