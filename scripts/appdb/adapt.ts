/**
 * ENGINE-V2 Phase 0: adapt the owner's app database to the canonical engine-v2 schema and report on it.
 *
 *   pnpm appdb:adapt             writes data/xero-apps/listings.json + docs/appdb-import-report.md
 *   pnpm appdb:adapt --dry-run   writes the report only
 *
 * Input: data/xero-apps/directory.json (see data/xero-apps/SOURCE.md). Output is keyed on listing_id, sorted, with no
 * timestamp, so a second run with the same inputs is byte-identical. Nothing is written to any database: loading
 * into xero_app_listings (migration 0025) and queue items appdb_match / catalog_gap are Phase 1.
 * Rollback: git checkout data/xero-apps/listings.json docs/appdb-import-report.md.
 */
import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { directory } from "@/lib/catalog/xero-directory";
import { apps as yamlApps, appCategories } from "@/lib/catalog/load";
import { adaptApp, mapCategories, matchListing, type CategoryMap, type Match } from "@/lib/appdb/adapt";
import { MARKETS, type XeroAppListing } from "@/lib/appdb/schema";

const OUT = "data/xero-apps/listings.json";
const REPORT = "docs/appdb-import-report.md";
const WORKBOOK_DATE = "2026-11-17";
const dry = process.argv.includes("--dry-run");

const dir = directory();
const catMap = parseYaml(fs.readFileSync("catalog/xero-category-map.yaml", "utf8")) as CategoryMap;
const fnVocab = new Set(Object.keys((parseYaml(fs.readFileSync("catalog/xero-functions.yaml", "utf8")) as { functions: Record<string, unknown> }).functions));
const xw = (parseYaml(fs.readFileSync("catalog/directory-crosswalk.yaml", "utf8")) as { links: Record<string, string | null> }).links;
const curated = yamlApps().filter((a) => a.id !== "xero");
const ourCats = appCategories().map((c) => c.key);

// ---------- adapt ----------
const accepted: XeroAppListing[] = [];
const rejected: { id: string; reasons: string[] }[] = [];
const droppedCount = new Map<string, number>();
const ratingSource = new Map<string, number>();
const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
for (const app of dir.apps) {
  const r = adaptApp(app, WORKBOOK_DATE);
  if (!r.ok) {
    rejected.push({ id: r.id, reasons: r.reasons });
    continue;
  }
  accepted.push(r.listing);
  for (const d of r.dropped) bump(droppedCount, `${d.what}: ${d.reason}`);
  bump(ratingSource, r.ratingSource);
}
accepted.sort((a, b) => a.listing_id.localeCompare(b.listing_id));

// ---------- match ----------
const reviewed = new Map(Object.entries(xw));
const listingsPerHost = new Map<string, number>();
for (const l of accepted) if (l.website) bump(listingsPerHost, l.website);
const raw = new Map<string, Match>(accepted.map((l) => [l.listing_id, matchListing(l, curated, { reviewed, listingsPerHost, claimed: new Set() })]));
// One catalogue app matched by two listings: neither is certain.
const claims = new Map<string, string[]>();
for (const [lid, m] of raw) if (m.status === "matched") claims.set(m.appId, [...(claims.get(m.appId) ?? []), lid]);
const matches = new Map<string, Match>();
for (const [lid, m] of raw) {
  if (m.status === "matched" && m.how !== "reviewed crosswalk" && claims.get(m.appId)!.length > 1)
    matches.set(lid, { status: "unsure", candidates: [{ appId: m.appId, why: `also matched by ${claims.get(m.appId)!.filter((x) => x !== lid).join(", ")}` }] });
  else matches.set(lid, m);
}
const matchedApps = new Set([...matches.values()].flatMap((m) => (m.status === "matched" ? [m.appId] : [])));
const curatedNoListing = curated.filter((a) => !matchedApps.has(a.id));

// ---------- categories + vocab ----------
const unknownCats = new Map<string, number>();
const unknownFns = new Map<string, number>();
const catsOf = new Map<string, string[]>();
for (const l of accepted) {
  const { categories, unknown } = mapCategories(l.xero_categories, catMap);
  catsOf.set(l.listing_id, categories);
  unknown.forEach((u) => bump(unknownCats, u));
  l.xero_functions.filter((f) => !fnVocab.has(f)).forEach((f) => bump(unknownFns, f));
}

// ---------- write ----------
const json = JSON.stringify({ version: 1, source: "data/xero-apps/directory.json", asOf: dir.asOf, listings: accepted }, null, 1) + "\n";
const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
if (!dry) fs.writeFileSync(OUT, json, "utf8");

// ---------- report ----------
const n = accepted.length;
const pct = (k: number, of = n) => (of ? `${Math.round((k / of) * 100)}%` : "–");
const L: string[] = [];
L.push("# App database import report (ENGINE-V2 Phase 0)", "");
L.push(
  `${dry ? "**Dry run**: nothing written." : `Written: \`${OUT}\`${before === json ? " (unchanged from the last run)" : before ? " (changed since the last run)" : " (new)"}.`} ` +
    `Source: \`data/xero-apps/directory.json\` (workbook 17 Nov 2026 + Xero listing pages read ${dir.asOf}); see \`data/xero-apps/SOURCE.md\`. ` +
    "No database writes: the table load and queue items are Phase 1 (migration 0025).",
  "",
);

L.push("## 1. Rows", "", "| | count |", "|---|---|");
L.push(`| rows read | ${dir.apps.length} |`, `| accepted | ${n} |`, `| rejected | ${rejected.length} |`);
L.push(`| quarantined in the handoff, never read (RemitClear AL-0081, Deel AL-0557) | 2 |`, "");
if (rejected.length) {
  L.push("Rejected rows:", "");
  for (const r of rejected) L.push(`- \`${r.id}\`: ${r.reasons.join("; ")}`);
  L.push("");
}
L.push("Parts of a row left out (the row is kept; nothing is filled in):", "", "| left out | reason | count |", "|---|---|---|");
for (const [k, v] of [...droppedCount].sort((a, b) => b[1] - a[1])) {
  const [what, reason] = k.split(": ");
  L.push(`| ${what} | ${reason} | ${v} |`);
}
L.push("");

L.push("## 2. Matching to `catalog/apps.yaml`", "");
const howCount = new Map<string, number>();
let unsure = 0;
let unmatched = 0;
for (const m of matches.values()) {
  if (m.status === "matched") bump(howCount, m.how);
  else if (m.status === "unsure") unsure++;
  else unmatched++;
}
L.push("Order: reviewed crosswalk (`catalog/directory-crosswalk.yaml`) → website domain → exact name → fuzzy name ≥ 0.93. Unsure = a shared domain, a catalogue app claimed by two listings, or a name 0.80–0.93 similar.", "");
L.push("| | listings |", "|---|---|");
for (const [k, v] of [...howCount].sort()) L.push(`| matched by ${k} | ${v} |`);
L.push(`| **matched** | **${[...howCount.values()].reduce((a, b) => a + b, 0)}** |`, `| unsure → queue item \`appdb_match\` (Phase 1) | ${unsure} |`, `| no catalogue app (not auto-created) | ${unmatched} |`, "");
L.push(`Catalogue apps (${curated.length}, excluding Xero itself) with no listing matched: **${curatedNoListing.length}**: ${curatedNoListing.map((a) => `\`${a.id}\``).join(", ") || "none"}.`, "");
if (unsure) {
  L.push("Unsure matches, for a person:", "", "| listing | name | catalogue candidates |", "|---|---|---|");
  for (const l of accepted) {
    const m = matches.get(l.listing_id)!;
    if (m.status === "unsure") L.push(`| \`${l.listing_id}\` | ${l.name} | ${m.candidates.map((c) => `\`${c.appId}\` (${c.why})`).join("; ")} |`);
  }
  L.push("");
}

L.push("## 3. Field completeness (accepted rows)", "", "| field | present | share | note |", "|---|---|---|---|");
const has = (f: (l: XeroAppListing) => boolean) => accepted.filter(f).length;
const rows: [string, number, string][] = [
  ["website", has((l) => !!l.website), ""],
  ["xero_categories", has((l) => l.xero_categories.length > 0), "empty = no listing read"],
  ["xero_functions", has((l) => l.xero_functions.length > 0), "the listing's data-flow section"],
  ["description", has((l) => !!l.description), "keyword matching + admin panel only"],
  ["rating_avg", has((l) => l.rating_avg !== null), "null = no reviews, or no listing"],
  ["review_count > 0", has((l) => (l.review_count ?? 0) > 0), ""],
  ["review_count = 0", has((l) => l.review_count === 0), "listed, no reviews yet (rating null, not low)"],
  ["review_count null", has((l) => l.review_count === null), "no listing read"],
  ["pricing_tiers (any)", has((l) => l.pricing_tiers.length > 0), ""],
  ["a tier with a £ price", has((l) => l.pricing_tiers.some((t) => t.price_gbp !== null)), "price_gbp null = quote, unknown or not in £"],
  ["a per-org £ tier", has((l) => l.pricing_tiers.some((t) => t.price_gbp !== null && t.unit === "org")), "what Phase 1 price scoring can use directly"],
  ["awards (official)", has((l) => l.awards.length > 0), "vendor claims are left out (see §1)"],
  ["markets", has((l) => l.markets.length > 0), "empty = not read (not 'unsupported')"],
  ["source_url", has((l) => !!l.source_url), ""],
];
for (const [k, v, note] of rows) L.push(`| ${k} | ${v} | ${pct(v)} | ${note} |`);
L.push("", `Rating source: ${[...ratingSource].map(([k, v]) => `${k} ${v}`).join(", ")} (workbook = no readable listing; the workbook's figure is kept and labelled).`, "");

L.push("## 4. Candidates per category × market", "");
L.push("Each cell: **all listings** / listings matched to a catalogue app / catalogue apps (apps.yaml) today. Under ENGINE-V2 §3 only catalogue apps are candidates, so the last two numbers are what v2 could rank without a person adding apps.", "");
L.push(`| our category | ${MARKETS.join(" | ")} |`, `|---|${MARKETS.map(() => "---").join("|")}|`);
const listingIdsByApp = new Map<string, string>();
for (const [lid, m] of matches) if (m.status === "matched") listingIdsByApp.set(m.appId, lid);
const gaps: string[] = [];
for (const c of ourCats) {
  const cells = MARKETS.map((mk) => {
    const all = accepted.filter((l) => catsOf.get(l.listing_id)!.includes(c) && l.markets.includes(mk)).length;
    const matched = accepted.filter((l) => matches.get(l.listing_id)!.status === "matched" && catsOf.get(l.listing_id)!.includes(c) && l.markets.includes(mk)).length;
    const cur = curated.filter((a) => a.categories.includes(c) && a.markets.includes(mk)).length;
    if (mk === "UK" && cur < 3 && c !== "other_software") gaps.push(`${c} (UK: ${cur} catalogue app${cur === 1 ? "" : "s"}, ${all} listings)`);
    return `**${all}** / ${matched} / ${cur}`;
  });
  L.push(`| ${c} | ${cells.join(" | ")} |`);
}
L.push("", `Categories with fewer than 3 catalogue apps in the UK (would need a \`catalog_gap\` warning under §1.4): ${gaps.join("; ") || "none"}.`, "");

L.push("## 5. Xero labels not in the hand-typed maps", "");
L.push(`- Xero categories not in \`catalog/xero-category-map.yaml\`: ${[...unknownCats].map(([k, v]) => `"${k}" (${v})`).join(", ") || "none"}.`);
L.push(`- Xero functions not in \`catalog/xero-functions.yaml\`: ${[...unknownFns].map(([k, v]) => `"${k}" (${v})`).join(", ") || "none"}.`);
const zeroCat = Object.entries(catMap.categories).filter(([, v]) => v.length === 0).map(([k]) => k);
L.push(`- Mapped to no FlowStack category on purpose (never a gap candidate alone): ${zeroCat.map((z) => `"${z}"`).join(", ")}.`, "");

L.push("## 6. Terms check (waiting on owner)", "");
L.push("Descriptions, ratings and review counts come from the public Xero App Store. Until the owner confirms the App Store terms allow it: descriptions are used only for keyword matching and shown only in the admin dev panel; ratings are shown only as numbers, attributed \"Xero App Store, captured <date>\"; no review text is stored or shown (none was collected).", "");

if (!fs.existsSync("docs")) fs.mkdirSync("docs");
fs.writeFileSync(REPORT, L.join("\n"), "utf8");
console.log(`${n} accepted, ${rejected.length} rejected; matched ${[...howCount.values()].reduce((a, b) => a + b, 0)}, unsure ${unsure}, unmatched ${unmatched}. Report: ${REPORT}${dry ? " (dry run)" : ""}`);

