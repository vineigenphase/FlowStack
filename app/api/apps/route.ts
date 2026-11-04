import { z } from "zod";
import { handle } from "@/lib/api";
import { listApps } from "@/lib/catalog/directory";

export const dynamic = "force-dynamic";

const Query = z.object({ category: z.string().optional(), market: z.enum(["UK", "US", "CA", "AU"]).optional() });

/** Public directory. No app pays to appear; order is alphabetical, not ranked. */
export const GET = handle(async (req: Request) => {
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const apps = (await listApps(q)).sort((a, b) => a.name.localeCompare(b.name));
  return { count: apps.length, apps };
});
