/**
 * ENGINE-V2 Phase 0: the owner's app database (data/xero-apps/directory.json, built from the reviewed workbook and
 * the public Xero listing pages) → the canonical XeroAppListing (lib/appdb/schema.ts), plus matching to
 * catalog/apps.yaml and mapping of Xero's categories to ours. Pure functions; scripts/appdb/adapt.ts runs them.
 *
 * Never fills gaps: a tier that can't be expressed in the canonical shape is dropped and counted with its reason,
 * an award without a year or with only a vendor's claim is left out and counted, unknown stays null.
 */
import type { DirApp, DirTier } from "@/lib/catalog/xero-directory";
import { XeroAppListing, type Award, type PricingTier, MARKETS } from "./schema";

export type Dropped = { what: "tier" | "award"; reason: string };
export type Adapted =
  | { ok: true; listing: XeroAppListing; dropped: Dropped[]; ratingSource: DirApp["rating"]["source"] }
  | { ok: false; id: string; reasons: string[] };

const REGION_TO_MARKET: Record<string, (typeof MARKETS)[number]> = { gb: "UK", us: "US", ca: "CA", au: "AU" };
const UNIT: Record<string, PricingTier["unit"]> = {
  flat: "org",
  free: "org",
  per_user: "user",
  per_client: "other",
  usage: "transaction",
  custom: "other",
};

export function host(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u.includes("://") ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** catalog/fx-rates.yaml: units of each currency per 1 of `base`. */
export type FxRates = { date: string; base: string; rates: Record<string, number> };

/** Pounds for an amount in `currency`, or null when the currency is unknown or has no rate. Rounded to the penny. */
export function toGbp(amount: number, currency: string, fx: FxRates): number | null {
  if (currency === "GBP") return amount;
  const gbp = fx.rates.GBP;
  const x = fx.rates[currency];
  if (!gbp || !x) return null;
  return Math.round(amount * (gbp / x) * 100) / 100;
}

export function adaptTier(t: DirTier, fx: FxRates): { tier: PricingTier } | { dropped: Dropped } {
  const drop = (reason: string) => ({ dropped: { what: "tier" as const, reason } });
  if (t.isTrial) return drop("free trial, not a price");
  if (t.period === "transaction") return drop("priced per transaction with no billing period");
  if (t.period === null) return drop("billing period not stated");
  let price: number | null = null;
  let original: PricingTier["original"];
  if (t.isFree && t.amount === 0) price = 0;
  else if (!t.isQuote && t.amount !== null && t.currency !== null) {
    price = toGbp(t.amount, t.currency, fx);
    if (price !== null && t.currency !== "GBP") original = { amount: t.amount, currency: t.currency, fx_date: fx.date };
  }
  const limits = [t.limits, t.minQuantity ? `minimum ${t.minQuantity} ${t.basis === "per_user" ? "users" : "units"}` : null, t.isFrom ? "price is a 'from' price" : null]
    .filter(Boolean)
    .join("; ");
  const tier: PricingTier = {
    name: t.name.trim(),
    price_gbp: price,
    period: t.period,
    unit: t.basis ? (UNIT[t.basis] ?? "other") : "other",
    ...(t.includes ? { included: t.includes } : {}),
    ...(limits ? { limits } : {}),
    ...(original ? { original } : {}),
  };
  return { tier };
}

export function adaptAward(a: DirApp["awards"][number]): { award: Award } | { dropped: Dropped } {
  const drop = (reason: string) => ({ dropped: { what: "award" as const, reason } });
  if (a.evidence !== "verified") return drop("vendor's own claim, not an official Xero record");
  if (a.year === null) return drop("year not stated");
  const level = /finalist/i.test(a.result) ? "finalist" : /winner/i.test(a.result) ? "winner" : null;
  if (!level) return drop(`result not winner or finalist: ${a.result}`);
  // The source names the programme but not which regional category was won. Owner decision 23 Nov 2026: such an
  // award counts as global. A region the source does state is kept.
  const region = /\b(UK|United Kingdom)\b/.test(a.category ?? "") ? "UK" : /\bANZ|Australia|New Zealand\b/.test(a.category ?? "") ? "ANZ" : /\b(US|United States)\b/.test(a.category ?? "") ? "US" : "global";
  return { award: { name: a.program, year: a.year, region, level } };
}

export function adaptApp(app: DirApp, workbookDate: string, fx: FxRates): Adapted {
  const dropped: Dropped[] = [];
  const tiers: PricingTier[] = [];
  for (const t of app.pricing.tiers) {
    const r = adaptTier(t, fx);
    if ("tier" in r) tiers.push(r.tier);
    else dropped.push(r.dropped);
  }
  const awards: Award[] = [];
  for (const a of app.awards) {
    const r = adaptAward(a);
    if ("award" in r) awards.push(r.award);
    else dropped.push(r.dropped);
  }
  const count = app.rating.count;
  // Xero shows "0" stars with 0 reviews: that is no rating, not a low one.
  const ratingAvg = count === 0 ? null : app.rating.value;
  const markets = [...new Set(app.regions.map((r) => REGION_TO_MARKET[r]).filter((m): m is (typeof MARKETS)[number] => !!m))].sort(
    (a, b) => MARKETS.indexOf(a) - MARKETS.indexOf(b),
  );
  const candidate = {
    listing_id: app.id,
    name: app.name,
    website: host(app.website),
    xero_categories: app.functions.map((f) => f.name),
    xero_functions: [...new Set(app.dataFlow.map((d) => d.object))],
    industries: app.industries.map((i) => i.name),
    description: app.description,
    rating_avg: ratingAvg,
    // Every Xero review carries a star rating, and the listing shows one count: it is both counts.
    rating_count: count,
    review_count: count,
    pricing_tiers: tiers,
    awards,
    markets,
    source_url: app.listing.url ?? app.website,
    captured_at: app.listing.checkedAt ?? workbookDate,
  };
  const res = XeroAppListing.safeParse(candidate);
  if (!res.success) return { ok: false, id: app.id, reasons: res.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`) };
  return { ok: true, listing: res.data, dropped, ratingSource: app.rating.source };
}

// ---------- categories ----------

export type CategoryMap = {
  categories: Record<string, string[]>;
  combos?: { all: string[]; drop: string[]; add: string[] }[];
};

export function mapCategories(labels: string[], map: CategoryMap): { categories: string[]; unknown: string[] } {
  const out = new Set<string>();
  const unknown: string[] = [];
  for (const l of labels) {
    const m = map.categories[l];
    if (m === undefined) unknown.push(l);
    else m.forEach((c) => out.add(c));
  }
  for (const c of map.combos ?? []) {
    if (c.all.every((l) => labels.includes(l))) {
      c.drop.forEach((d) => out.delete(d));
      c.add.forEach((a) => out.add(a));
    }
  }
  return { categories: [...out].sort(), unknown };
}

// ---------- matching to catalog/apps.yaml ----------

export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(ltd|limited|inc|uk|app|for xero|xero)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/** Similarity 0–1 from the Levenshtein distance on normalised names. */
export function similarity(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x.length && !y.length) return 1;
  const d: number[] = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - d[y.length]! / Math.max(x.length, y.length);
}

export type CatalogueApp = { id: string; name: string; website?: string | null };
export type Match =
  | { status: "matched"; appId: string; how: "reviewed crosswalk" | "website" | "exact name" | "fuzzy name"; score?: number }
  | { status: "unsure"; candidates: { appId: string; why: string }[] }
  | { status: "unmatched" };

export const FUZZY_MATCH = 0.93;
export const FUZZY_UNSURE = 0.8;

/**
 * Website domain first, then exact name, then fuzzy (≥ 0.93), per ENGINE-V2 Phase 0 §3. A reviewed crosswalk entry
 * (catalog/directory-crosswalk.yaml) settles a case a person already checked. A domain or name shared by several
 * listings, or a near-miss name (0.80–0.93), is "unsure" and goes to a person (queue item appdb_match).
 */
export function matchListing(
  l: Pick<XeroAppListing, "listing_id" | "name" | "website">,
  apps: CatalogueApp[],
  ctx: {
    /** catalogue app id → its reviewed listing id(s); null = checked, no listing. */
    reviewed: Map<string, string | string[] | null>;
    /** listing id → catalogue app ids a person said it is NOT. */
    different?: Map<string, string[]>;
    listingsPerHost: Map<string, number>;
    claimed: Set<string>;
  },
): Match {
  for (const [appId, listingIds] of ctx.reviewed) if ([listingIds].flat().includes(l.listing_id)) return { status: "matched", appId, how: "reviewed crosswalk" };
  const notThese = new Set(ctx.different?.get(l.listing_id) ?? []);
  const pool = apps.filter((a) => !ctx.reviewed.has(a.id) && !ctx.claimed.has(a.id) && !notThese.has(a.id));
  const h = l.website;
  if (h) {
    const byHost = pool.filter((a) => host(a.website) === h);
    if (byHost.length === 1 && (ctx.listingsPerHost.get(h) ?? 0) === 1) return { status: "matched", appId: byHost[0]!.id, how: "website" };
    if (byHost.length >= 1) return { status: "unsure", candidates: byHost.map((a) => ({ appId: a.id, why: `same website (${h}), shared by ${ctx.listingsPerHost.get(h)} listings` })) };
  }
  const exact = pool.filter((a) => normName(a.name) === normName(l.name));
  if (exact.length === 1) return { status: "matched", appId: exact[0]!.id, how: "exact name" };
  if (exact.length > 1) return { status: "unsure", candidates: exact.map((a) => ({ appId: a.id, why: "same name" })) };
  const scored = pool.map((a) => ({ a, s: similarity(a.name, l.name) })).sort((p, q) => q.s - p.s);
  const best = scored[0];
  if (best && best.s >= FUZZY_MATCH && (scored[1]?.s ?? 0) < FUZZY_MATCH) return { status: "matched", appId: best.a.id, how: "fuzzy name", score: round2(best.s) };
  const near = scored.filter((x) => x.s >= FUZZY_UNSURE);
  if (near.length) return { status: "unsure", candidates: near.map((x) => ({ appId: x.a.id, why: `similar name (${round2(x.s)})` })) };
  return { status: "unmatched" };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
