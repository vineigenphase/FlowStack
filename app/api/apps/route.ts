import { z } from "zod";
import { handle } from "@/lib/api";
import { appCards } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

const Query = z.object({
  category: z.string().max(60).optional(),
  market: z.enum(["UK", "US", "CA", "AU"]).optional(),
  q: z.string().trim().max(80).optional(),
});

/** Public directory (UI-SPEC §5.8 `AppCard[]`). No app pays to appear; order is alphabetical, not ranked. */
export const GET = handle(async (req: Request) => {
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  return appCards(q);
});
