/**
 * ENGINE-V2: the candidate pool. Every Xero listing is a candidate (owner decision 23 Nov 2026); where a listing
 * matches a catalogue app (catalog/apps.yaml, via data/xero-apps/matches.json) the catalogue entry is used, with the
 * listing's data attached. Catalogue apps keep their hand-checked categories, markets and integration edges; directory
 * apps get categories from catalog/xero-category-map.yaml and markets from the listing.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { apps as catalogApps, type App } from "@/lib/catalog/load";
import { mapCategories, type CategoryMap, type Match } from "@/lib/appdb/adapt";
import { XeroAppListing } from "@/lib/appdb/schema";

export type V2App = {
  id: string;
  name: string;
  /** In catalog/apps.yaml (hand-checked categories and integration edges). */
  curated: App | null;
  categories: string[];
  /** Empty = not known (no listing read), never "unsupported". */
  markets: string[];
  /** The Xero listing (the one with most reviews when a catalogue app has two). */
  listing: XeroAppListing | null;
  /** Xero functions across all of the app's listings. */
  functions: string[];
  /** Xero industries across all of the app's listings (empty = none listed). */
  industries: string[];
};

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
let cache: V2App[] | null = null;

export function clearV2AppsCache() {
  cache = null;
}

export function buildV2Apps(curated: App[], listings: XeroAppListing[], matches: ({ listing_id: string } & Match)[], catMap: CategoryMap): V2App[] {
  const byListing = new Map(listings.map((l) => [l.listing_id, l]));
  const listingsOf = new Map<string, XeroAppListing[]>();
  const matched = new Set<string>();
  for (const m of matches) {
    if (m.status !== "matched") continue;
    matched.add(m.listing_id);
    const l = byListing.get(m.listing_id);
    if (l) listingsOf.set(m.appId, [...(listingsOf.get(m.appId) ?? []), l]);
  }
  const out: V2App[] = [];
  for (const a of curated) {
    if (a.id === "xero") continue;
    const ls = (listingsOf.get(a.id) ?? []).sort((x, y) => (y.review_count ?? -1) - (x.review_count ?? -1) || x.listing_id.localeCompare(y.listing_id));
    out.push({
      id: a.id,
      name: a.name,
      curated: a,
      categories: a.categories,
      markets: a.markets,
      listing: ls[0] ?? null,
      functions: [...new Set(ls.flatMap((l) => l.xero_functions))].sort(),
      industries: [...new Set(ls.flatMap((l) => l.industries))].sort(),
    });
  }
  for (const l of listings) {
    if (matched.has(l.listing_id)) continue;
    out.push({
      id: l.listing_id,
      name: l.name,
      curated: null,
      categories: mapCategories(l.xero_categories, catMap).categories,
      markets: l.markets,
      listing: l,
      functions: [...l.xero_functions].sort(),
      industries: [...l.industries].sort(),
    });
  }
  return out;
}

/** The pool from the repo's files (cached per process). */
export function v2Apps(): V2App[] {
  if (cache) return cache;
  const listings = (JSON.parse(read("data/xero-apps/listings.json")) as { listings: unknown[] }).listings.map((l) => XeroAppListing.parse(l));
  const matches = (JSON.parse(read("data/xero-apps/matches.json")) as { matches: ({ listing_id: string } & Match)[] }).matches;
  const catMap = parseYaml(read("catalog/xero-category-map.yaml")) as CategoryMap;
  cache = buildV2Apps(catalogApps(), listings, matches, catMap);
  return cache;
}
