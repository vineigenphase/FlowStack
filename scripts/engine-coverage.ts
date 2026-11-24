/**
 * ENGINE-V2 §1.4: `pnpm engine:coverage` prints
 *   - v2 candidates per (category × market)
 *   - v2 field completeness for the candidates in each category
 *   - rules with no required_functions or keywords yet
 * Reads files only (catalogue + data/xero-apps). No database.
 */
import { appCategories, rulesFile } from "@/lib/catalog/load";
import { v2Apps } from "@/lib/rank/v2/apps";
import { MIN_CANDIDATES } from "@/lib/rank/v2/score";

const MARKETS = ["UK", "US", "CA", "AU"];
const pool = v2Apps();
const cats = appCategories().map((c) => c.key).filter((c) => c !== "other_software");
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%`.padStart(4) : "   –");

console.log(`Engine v2 candidate pool: ${pool.length} apps (${pool.filter((a) => a.curated).length} catalogue, ${pool.filter((a) => !a.curated).length} Xero directory only)\n`);
console.log("Candidates per category × market (markets unknown count everywhere, marked uncertain):");
console.log(`${"category".padEnd(22)}${MARKETS.map((m) => m.padStart(7)).join("")}`);
const thin: string[] = [];
for (const c of cats) {
  const row = MARKETS.map((m) => {
    const n = pool.filter((a) => a.categories.includes(c) && (a.markets.length === 0 || a.markets.includes(m))).length;
    if (n < MIN_CANDIDATES) thin.push(`${c} in ${m} (${n})`);
    return String(n).padStart(7);
  });
  console.log(`${c.padEnd(22)}${row.join("")}`);
}
console.log(`\nBelow ${MIN_CANDIDATES} candidates (a flagged line here gets a catalog_gap warning + queue item): ${thin.join(", ") || "none"}\n`);

console.log("v2 field completeness per category (share of candidates with the input; missing scores neutral 0.5):");
console.log(`${"category".padEnd(22)}${["apps", "listing", "rating", "functns", "descr", "£ price", "awards"].map((h) => h.padStart(8)).join("")}`);
for (const c of cats) {
  const xs = pool.filter((a) => a.categories.includes(c));
  const n = xs.length;
  const cells = [
    String(n).padStart(8),
    pct(xs.filter((a) => a.listing).length, n).padStart(8),
    pct(xs.filter((a) => a.listing?.rating_avg != null && (a.listing.review_count ?? 0) > 0).length, n).padStart(8),
    pct(xs.filter((a) => a.functions.length).length, n).padStart(8),
    pct(xs.filter((a) => a.listing?.description).length, n).padStart(8),
    pct(xs.filter((a) => a.listing?.pricing_tiers.some((t) => t.price_gbp !== null)).length, n).padStart(8),
    pct(xs.filter((a) => a.listing?.awards.length).length, n).padStart(8),
  ];
  console.log(`${c.padEnd(22)}${cells.join("")}`);
}

const rules = rulesFile().rules.filter((r) => r.app_categories.length);
const noFn = rules.filter((r) => !r.required_functions.length && !r.helpful_functions.length).map((r) => r.id);
const noKw = rules.filter((r) => !r.keywords.length).map((r) => r.id);
console.log(`\nRules with no required/helpful Xero functions: ${noFn.join(", ") || "none"}`);
console.log(`Rules with no keywords: ${noKw.join(", ") || "none"}`);
