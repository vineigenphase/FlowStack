import { handle } from "@/lib/api";
import { requireCron } from "@/lib/cron";
import { crawlAll } from "@/lib/crawl";
import { apps as catalogApps } from "@/lib/catalog/load";
import { refreshVendor } from "@/lib/vendors/companies-house";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 03:41 on the 1st: crawl the catalogue, then refresh Companies House facts (v1.1 L) for apps with a company number. */
export const GET = handle(async (req: Request) => {
  requireCron(req);
  const out = await crawlAll();
  let vendors = 0;
  for (const a of catalogApps().filter((x) => x.companies_house)) if ("facts" in (await refreshVendor(a.id))) vendors++;
  return { apps: out.length, found: out.reduce((s, a) => s + a.found.length, 0), queued: out.reduce((s, a) => s + a.queued, 0), vendors };
});
