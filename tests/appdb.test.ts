// ENGINE-V2 Phase 0: the app database adapter (lib/appdb), its output (data/xero-apps/listings.json) and the maps.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { adaptApp, adaptAward, adaptTier as adaptTierFx, mapCategories, matchListing, similarity, toGbp, type CategoryMap, type FxRates } from "@/lib/appdb/adapt";
import { engineV2Review, leafKeys, tierText, weightRows } from "@/lib/appdb/review";
import { rulesFile } from "@/lib/catalog/load";
import { XeroAppListing } from "@/lib/appdb/schema";
import { directory } from "@/lib/catalog/xero-directory";
import type { DirApp, DirTier } from "@/lib/catalog/xero-directory";

const tier = (t: Partial<DirTier>): DirTier => ({
  id: "T", name: "Plan", priceRaw: null, amount: null, currency: null, period: "month", basis: "flat",
  isQuote: false, isFree: false, isTrial: false, isFrom: false, minQuantity: null, includes: null, limits: null,
  flags: [], sourceUrl: null, checkedAt: null, ...t,
});
const fx: FxRates = { date: "2026-11-20", base: "EUR", rates: { GBP: 0.8, USD: 1.0, AUD: 1.6, EUR: 1 } };
const adaptTier = (t: DirTier) => adaptTierFx(t, fx);
const catMap = parseYaml(fs.readFileSync("catalog/xero-category-map.yaml", "utf8")) as CategoryMap;
const listingsFile = JSON.parse(fs.readFileSync("data/xero-apps/listings.json", "utf8")) as { listings: unknown[] };

describe("adapter: unknown stays unknown", () => {
  it("prices are converted to £ and keep the vendor's own figure; a $ with no currency is never guessed", () => {
    const gbp = adaptTier(tier({ amount: 25, currency: "GBP" }));
    const usd = adaptTier(tier({ amount: 29, currency: "USD" }));
    const noCur = adaptTier(tier({ amount: 29, currency: null, priceRaw: "$29/mo" }));
    const noRate = adaptTier(tier({ amount: 29, currency: "JPY" }));
    expect("tier" in gbp && gbp.tier).toMatchObject({ price_gbp: 25 });
    expect("tier" in gbp && gbp.tier.original).toBeUndefined();
    expect("tier" in usd && usd.tier).toMatchObject({ price_gbp: 23.2, original: { amount: 29, currency: "USD", fx_date: "2026-11-20" } });
    expect("tier" in noCur && noCur.tier.price_gbp).toBeNull();
    expect("tier" in noRate && noRate.tier.price_gbp).toBeNull();
    expect(toGbp(16, "AUD", fx)).toBe(8);
    expect("tier" in usd && tierText(usd.tier)).toBe("Plan: £23.20/month (USD 29)");
  });

  it("quote-only is null (not free); an explicit free plan is 0; trials and unstated periods are left out with a reason", () => {
    const quote = adaptTier(tier({ isQuote: true, amount: null, currency: "GBP" }));
    const free = adaptTier(tier({ isFree: true, amount: 0, basis: "free" }));
    expect("tier" in quote && quote.tier.price_gbp).toBeNull();
    expect("tier" in free && free.tier.price_gbp).toBe(0);
    expect(adaptTier(tier({ isTrial: true }))).toEqual({ dropped: { what: "tier", reason: "free trial, not a price" } });
    expect("dropped" in adaptTier(tier({ period: null }))).toBe(true);
    expect("dropped" in adaptTier(tier({ period: "transaction" }))).toBe(true);
  });

  it("per-user tiers keep the unit and the minimum seats", () => {
    const r = adaptTier(tier({ amount: 6, currency: "GBP", basis: "per_user", minQuantity: 5 }));
    expect("tier" in r && r.tier).toMatchObject({ unit: "user", price_gbp: 6, limits: "minimum 5 users" });
  });

  it("awards: official records only, never a vendor's claim; an unstated region counts as global (owner 23 Nov)", () => {
    const official = adaptAward({ id: "A", program: "Xero Global App Awards", year: 2025, category: "unknown", result: "winner (listed)", evidence: "verified", sourceUrl: null });
    expect(official).toEqual({ award: { name: "Xero Global App Awards", year: 2025, region: "global", level: "winner" } });
    expect("dropped" in adaptAward({ id: "B", program: "Xero App Awards", year: 2024, category: null, result: "winner (vendor claim)", evidence: "source-reported", sourceUrl: null })).toBe(true);
    expect("dropped" in adaptAward({ id: "C", program: "Xero App Awards", year: null, category: null, result: "winner", evidence: "verified", sourceUrl: null })).toBe(true);
  });

  it("0 reviews is no rating (null), not a low one; ratings are otherwise kept exactly as listed", () => {
    const dir = directory();
    const zero = dir.apps.find((a) => a.rating.count === 0)!;
    const rated = dir.apps.find((a) => (a.rating.count ?? 0) > 50)!;
    const z = adaptApp(zero, "2026-11-17", fx);
    const r = adaptApp(rated, "2026-11-17", fx);
    expect(z.ok && z.listing.rating_avg).toBeNull();
    expect(z.ok && z.listing.review_count).toBe(0);
    expect(r.ok && r.listing.rating_avg).toBe(rated.rating.value);
  });

  it("a row that fails the schema is rejected with reasons, not patched", () => {
    const bad = { ...directory().apps[0]!, id: "Not An Id" } as DirApp;
    const r = adaptApp(bad, "2026-11-17", fx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reasons.join(" ")).toMatch(/listing_id/);
  });
});

describe("output file and maps", () => {
  it("every listing in listings.json passes the canonical schema; ids are unique and sorted", () => {
    const ids = listingsFile.listings.map((l) => XeroAppListing.parse(l).listing_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a.localeCompare(b))).toEqual(ids);
  });

  it("no name keeps trailing spaces; the two Employment Hero products stay two listings", () => {
    const ls = listingsFile.listings.map((l) => XeroAppListing.parse(l));
    expect(ls.every((l) => l.name === l.name.trim())).toBe(true);
    expect(ls.filter((l) => l.name === "Employment Hero").length + ls.filter((l) => /^Employment Hero/.test(l.name)).length).toBeGreaterThanOrEqual(2);
  });

  it("every Xero category and function on a listing is in the hand-typed maps", () => {
    const fns = new Set(Object.keys((parseYaml(fs.readFileSync("catalog/xero-functions.yaml", "utf8")) as { functions: object }).functions));
    for (const l of listingsFile.listings.map((x) => XeroAppListing.parse(x))) {
      expect(mapCategories(l.xero_categories, catMap).unknown).toEqual([]);
      expect(l.xero_functions.filter((f) => !fns.has(f))).toEqual([]);
    }
  });

  it("category map only names FlowStack categories that exist; Payroll HR + Time tracking is rota, not payroll", () => {
    const ours = new Set((parseYaml(fs.readFileSync("catalog/app-categories.yaml", "utf8")) as { key: string }[]).map((c) => c.key));
    for (const cats of Object.values(catMap.categories)) for (const c of cats) expect(ours.has(c)).toBe(true);
    expect(mapCategories(["Payroll HR", "Time tracking"], catMap).categories).toEqual(["rota"]);
    expect(mapCategories(["Payroll HR"], catMap).categories).toEqual(["payroll"]);
    expect(mapCategories(["Made up"], catMap).unknown).toEqual(["Made up"]);
  });
});

describe("matching listings to catalog/apps.yaml", () => {
  const apps = [
    { id: "chaser", name: "Chaser", website: "https://www.chaserhq.com" },
    { id: "cin7", name: "Cin7", website: "https://www.cin7.com" },
    { id: "soldo", name: "Soldo", website: "https://www.soldo.com" },
    { id: "gusto", name: "Gusto", website: "https://gusto.com" },
  ];
  const ctx = (hosts: Record<string, number>, reviewed: Record<string, string | null> = {}) => ({
    reviewed: new Map(Object.entries(reviewed)),
    listingsPerHost: new Map(Object.entries(hosts)),
    claimed: new Set<string>(),
  });

  it("website first; a domain shared by two listings is unsure, not a guess", () => {
    expect(matchListing({ listing_id: "xa-chaser", name: "Chaser HQ", website: "chaserhq.com" }, apps, ctx({ "chaserhq.com": 1 }))).toMatchObject({ status: "matched", appId: "chaser", how: "website" });
    expect(matchListing({ listing_id: "xa-cin7-core", name: "Cin7", website: "cin7.com" }, apps, ctx({ "cin7.com": 2 })).status).toBe("unsure");
  });

  it("a reviewed crosswalk entry settles it, and null means 'checked: no listing'", () => {
    expect(matchListing({ listing_id: "xa-cin7-core", name: "Cin7", website: "cin7.com" }, apps, ctx({ "cin7.com": 2 }, { cin7: "xa-cin7-core" }))).toMatchObject({ status: "matched", how: "reviewed crosswalk" });
    expect(matchListing({ listing_id: "xa-gusto", name: "Gusto", website: null }, apps, ctx({}, { gusto: null })).status).toBe("unmatched");
  });

  it("fuzzy needs ≥ 0.93; a near miss (Solido vs Soldo) goes to a person", () => {
    expect(similarity("Solido", "Soldo")).toBeLessThan(0.93);
    expect(matchListing({ listing_id: "xa-solido", name: "Solido", website: "solido.io" }, apps, ctx({ "solido.io": 1 })).status).toBe("unsure");
    expect(matchListing({ listing_id: "xa-x", name: "Something Else Entirely", website: "else.io" }, apps, ctx({ "else.io": 1 })).status).toBe("unmatched");
  });
});

describe("v2 weights and the admin review page data", () => {
  it("rules.yaml scoring_v2 parses; top level is 0.50/0.35/0.10/0.05; the leaf shares add up to the whole match", () => {
    const s = rulesFile().scoring_v2!;
    expect(s.weights).toEqual({ strength: 0.5, fit: 0.35, quality: 0.1, price: 0.05 });
    const rows = weightRows(s);
    const total = rows.filter((r) => leafKeys.includes(r.key)).reduce((a, r) => a + r.share, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(rows.find((r) => r.key === "keyword_match")!.share).toBeCloseTo(s.weights.fit * s.fit.job_fit * s.job_fit.keyword_match, 6);
    expect(rows.find((r) => r.key === "industry_fit")!.share).toBeCloseTo(0.35 * 0.4 * 0.15, 6);
  });

  it("the review page lists every unsure match with both sides, and nothing else", () => {
    const r = engineV2Review();
    expect(r.unsure.length).toBe(r.count.unsure);
    expect(r.count.matched + r.count.unsure + r.count.unmatched).toBe(r.count.listings);
    for (const u of r.unsure) expect(u.candidates.length).toBeGreaterThan(0);
    // Owner 23 Nov: Cin7 ×2 and Modulr ×2 are the same apps; ApprovalMGR and Solido are different. Nothing left to check.
    expect(r.unsure).toEqual([]);
  });
});

describe("owner's match answers (23 Nov 2026)", () => {
  const m = new Map((JSON.parse(fs.readFileSync("data/xero-apps/matches.json", "utf8")) as { matches: { listing_id: string; status: string; appId?: string }[] }).matches.map((x) => [x.listing_id, x]));
  it("two listings can belong to one catalogue app; a 'different' answer is never asked again", () => {
    expect(m.get("xa-cin7-core")).toMatchObject({ status: "matched", appId: "cin7" });
    expect(m.get("xa-cin7-omni")).toMatchObject({ status: "matched", appId: "cin7" });
    expect(m.get("xa-modulr")).toMatchObject({ status: "matched", appId: "modulr" });
    expect(m.get("xa-nook")).toMatchObject({ status: "matched", appId: "modulr" });
    expect(m.get("xa-approvalmgr")!.status).toBe("unmatched");
    expect(m.get("xa-solido")!.status).toBe("unmatched");
  });
  it("approved weights show as decided; only the keys listed as proposed (the industry-fit split) show as proposed", () => {
    const rows = weightRows(rulesFile().scoring_v2!);
    expect(rows.filter((w) => w.status === "proposed").map((w) => w.key).sort()).toEqual(["category_match", "function_match", "industry_fit", "keyword_match"]);
    expect(rows.find((w) => w.key === "rating_score")!.status).toBe("decided");
  });
});
