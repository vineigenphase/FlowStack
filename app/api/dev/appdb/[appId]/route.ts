import { handle, HttpError, type Params } from "@/lib/api";
import { requireDevTools } from "@/lib/rank/v2/dev";
import { v2Apps } from "@/lib/rank/v2/apps";

export const dynamic = "force-dynamic";

/** ENGINE-V2 §2.3 Data tab: the app database record behind one candidate (admins with dev tools only). */
export const GET = handle(async (_req: Request, { params }: Params<{ appId: string }>) => {
  await requireDevTools();
  const { appId } = await params;
  const a = v2Apps().find((x) => x.id === decodeURIComponent(appId));
  if (!a) throw new HttpError(404, "Not found");
  const l = a.listing;
  const fields: [string, boolean][] = [
    ["Xero listing", !!l],
    ["Rating", l?.rating_avg != null && (l.review_count ?? 0) > 0],
    ["Xero functions", a.functions.length > 0],
    ["Industries", a.industries.length > 0],
    ["Description", !!l?.description],
    ["£ price", !!l?.pricing_tiers.some((t) => t.price_gbp !== null)],
    ["Markets", a.markets.length > 0],
  ];
  return {
    id: a.id,
    name: a.name,
    inCatalogue: !!a.curated,
    categories: a.categories,
    markets: a.markets,
    functions: a.functions,
    industries: a.industries,
    integrations: a.curated?.integrations ?? [],
    listing: l,
    completeness: { present: fields.filter((f) => f[1]).length, of: fields.length, fields: fields.map(([k, v]) => ({ field: k, present: v })) },
  };
});
