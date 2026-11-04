import { z } from "zod";
import { body, handle } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { crawlAll, crawlApp } from "@/lib/crawl";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ app_id: z.string().optional() });

/** Crawl one app (`{app_id}`) or all. */
export const POST = handle(async (req: Request) => {
  await requireAdmin();
  const b = await body(req, Body);
  return b.app_id ? crawlApp(b.app_id) : { apps: await crawlAll() };
});
