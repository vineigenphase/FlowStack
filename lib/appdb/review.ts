/**
 * ENGINE-V2: what the admin review page (/admin/engine-v2) shows: the unsure listing matches, the v2 weights from
 * rules.yaml (with each part's share of the final match), the Xero → FlowStack category map and the data summary.
 * Read-only; everything comes from files in the repo (data/xero-apps/*.json, catalog/*.yaml).
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { apps as yamlApps, appCategories, rulesFile, type ScoringV2 } from "@/lib/catalog/load";
import { mapCategories, type CategoryMap, type FxRates, type Match } from "./adapt";
import { XeroAppListing } from "./schema";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

export type WeightRow = { key: string; label: string; parent: string | null; weight: number; share: number; status: "decided" | "proposed" };
export type UnsureRow = {
  listing: XeroAppListing;
  categories: string[];
  candidates: { appId: string; why: string; name: string; website: string | null; categories: string[]; markets: string[] }[];
};

export function weightRows(s: ScoringV2): WeightRow[] {
  const rows: WeightRow[] = [];
  const sub: WeightRow["status"] = /PROPOSED/i.test(s.status.sub_weights) ? "proposed" : "decided";
  const add = (key: string, label: string, parent: string | null, weight: number, share: number, status: WeightRow["status"]) =>
    rows.push({ key, label, parent, weight, share, status });
  add("strength", "Strength (coverage × materiality)", null, s.weights.strength, s.weights.strength, "decided");
  add("fit", "Fit", null, s.weights.fit, s.weights.fit, "decided");
  add("integration_fit", "Integration fit with apps kept", "fit", s.fit.integration_fit, s.weights.fit * s.fit.integration_fit, sub);
  add("job_fit", "Job fit", "fit", s.fit.job_fit, s.weights.fit * s.fit.job_fit, sub);
  const jf = s.weights.fit * s.fit.job_fit;
  add("category_match", "Category match", "job_fit", s.job_fit.category_match, jf * s.job_fit.category_match, sub);
  add("function_match", "Xero function match", "job_fit", s.job_fit.function_match, jf * s.job_fit.function_match, sub);
  add("keyword_match", "Keyword match (description)", "job_fit", s.job_fit.keyword_match, jf * s.job_fit.keyword_match, sub);
  add("quality", "Quality", null, s.weights.quality, s.weights.quality, "decided");
  add("rating_score", "Xero rating (Bayesian)", "quality", s.quality.rating_score, s.weights.quality * s.quality.rating_score, sub);
  add("volume_score", "Review volume", "quality", s.quality.volume_score, s.weights.quality * s.quality.volume_score, sub);
  add("price", "Price vs revenue", null, s.weights.price, s.weights.price, "decided");
  return rows;
}

/** The parts with no children: their shares add up to 1 (award boost sits on top of quality, capped). */
export const leafKeys = ["strength", "integration_fit", "category_match", "function_match", "keyword_match", "rating_score", "volume_score", "price"];

export function engineV2Review() {
  const scoring = rulesFile().scoring_v2;
  if (!scoring) throw new Error("catalog/rules.yaml has no scoring_v2");
  const listingsFile = JSON.parse(read("data/xero-apps/listings.json")) as { asOf: string; listings: unknown[] };
  const listings = listingsFile.listings.map((l) => XeroAppListing.parse(l));
  const byId = new Map(listings.map((l) => [l.listing_id, l]));
  const matches = (JSON.parse(read("data/xero-apps/matches.json")) as { matches: ({ listing_id: string } & Match)[] }).matches;
  const catMap = parseYaml(read("catalog/xero-category-map.yaml")) as CategoryMap;
  const fx = parseYaml(read("catalog/fx-rates.yaml")) as FxRates & { source: string; source_url: string };
  const curated = new Map(yamlApps().map((a) => [a.id, a]));
  const catLabel = new Map(appCategories().map((c) => [c.key, c.label]));

  const unsure: UnsureRow[] = matches
    .filter((m): m is { listing_id: string } & Extract<Match, { status: "unsure" }> => m.status === "unsure")
    .map((m) => {
      const listing = byId.get(m.listing_id)!;
      return {
        listing,
        categories: mapCategories(listing.xero_categories, catMap).categories,
        candidates: m.candidates.map((c) => {
          const a = curated.get(c.appId);
          return { appId: c.appId, why: c.why, name: a?.name ?? c.appId, website: a?.website ?? null, categories: a?.categories ?? [], markets: a?.markets ?? [] };
        }),
      };
    });

  const count = { listings: listings.length, matched: 0, unsure: unsure.length, unmatched: 0 };
  for (const m of matches) if (m.status === "matched") count.matched++;
  else if (m.status === "unmatched") count.unmatched++;

  const categoryRows = Object.entries(catMap.categories).map(([label, cats]) => ({
    label,
    ours: cats.map((c) => catLabel.get(c) ?? c),
    listings: listings.filter((l) => l.xero_categories.includes(label)).length,
  }));
  categoryRows.sort((a, b) => b.listings - a.listings);

  const tiers = listings.flatMap((l) => l.pricing_tiers);
  const prices = {
    withGbp: listings.filter((l) => l.pricing_tiers.some((t) => t.price_gbp !== null)).length,
    converted: tiers.filter((t) => t.original).length,
  };

  return { scoring, weights: weightRows(scoring), unsure, count, categoryRows, combos: catMap.combos ?? [], fx, prices, asOf: listingsFile.asOf, catLabel };
}

/** "£12.50/month per user" for a tier; the vendor's own figure in brackets when converted. */
export function tierText(t: XeroAppListing["pricing_tiers"][number]): string {
  const per = { org: "", user: " per user", employee: " per employee", transaction: " per transaction", other: "" }[t.unit];
  const period = { month: "/month", year: "/year", one_off: " one-off" }[t.period];
  if (t.price_gbp === null) return `${t.name}: price not published`;
  const gbp = t.price_gbp === 0 ? "free" : `£${t.price_gbp.toFixed(2)}${period}${per}`;
  return `${t.name}: ${gbp}${t.original ? ` (${t.original.currency} ${t.original.amount})` : ""}`;
}
