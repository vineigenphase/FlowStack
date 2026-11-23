/**
 * Builds data/xero-apps/directory.json (the app directory database) from:
 *   data/xero-apps/handoff/csv/{apps,pricing_tiers_norm,app_awards,fs_mappings}.csv   (reviewed workbook tables)
 *   data/xero-apps/handoff/enrichment_run/raw/<slug>.json + fetch_log.csv           (public Xero listing pages)
 *   catalog/directory-crosswalk.yaml                                                    (reviewed links to catalog/apps.yaml)
 *
 * Idempotent: keyed on the reviewed app id; output sorted; no build timestamp, so the same inputs give the same
 * bytes and a second run changes nothing. Quarantined rows (data/xero-apps/handoff/quarantine/) are never
 * imported. Every run writes docs/catalogue/directory-import-report.md (counts, problems, changes vs the last build).
 *
 *   npx tsx scripts/catalogue/build-directory.ts            build + report
 *   npx tsx scripts/catalogue/build-directory.ts --dry-run  report only; data/xero-apps/directory.json untouched
 * Rollback: git checkout data/xero-apps/directory.json (the file is versioned; nothing else is written).
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseCsv } from "@/lib/eval/review";
import { apps as yamlApps } from "@/lib/catalog/load";
import { DirectoryFile, type DirApp, type DirTier } from "@/lib/catalog/xero-directory";

const H = "data/xero-apps/handoff";
const RAW = `${H}/enrichment_run/raw`;
const OUT = "data/xero-apps/directory.json";
const REPORT = "docs/catalogue/directory-import-report.md";
const dry = process.argv.includes("--dry-run");

type Row = Record<string, string>;
function readCsv(p: string): Row[] {
  if (!fs.existsSync(p)) return [];
  const [head, ...rows] = parseCsv(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
  return rows.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}
const nul = (s: string | undefined) => (s === undefined || s.trim() === "" ? null : s.trim());
const num = (s: string | undefined) => {
  const v = nul(s);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (s: string | undefined) => (nul(s) === null ? null : s!.trim().toUpperCase() === "TRUE");

const problems: string[] = [];
const notes: string[] = [];

// ---------- workbook tables ----------
const appRows = readCsv(`${H}/csv/apps.csv`);
const tierRows = readCsv(`${H}/csv/pricing_tiers_norm.csv`);
const awardRows = readCsv(`${H}/csv/app_awards.csv`);
const mapRows = readCsv(`${H}/csv/fs_mappings.csv`);
const quarantined = readCsv(`${H}/quarantine/identity_crosswalk_quarantined.csv`);
const fetchLog = new Map(readCsv(`${H}/enrichment_run/fetch_log.csv`).map((r) => [r.slug!, r]));

const ids = new Set<string>();
for (const r of appRows) {
  if (ids.has(r.app_id!)) problems.push(`duplicate app_id ${r.app_id} in apps.csv`);
  ids.add(r.app_id!);
  if (bool(r.ready_to_import) === false) problems.push(`apps.csv ${r.app_id} is not ready_to_import but is in the importable table`);
}
const quarantinedIds = new Set(quarantined.map((q) => q.record_id));

// ---------- crosswalk to the curated catalogue ----------
const xwFile = "catalog/directory-crosswalk.yaml";
const xw = (fs.existsSync(xwFile) ? (parseYaml(fs.readFileSync(xwFile, "utf8")) as { links?: Record<string, string | string[] | null> }) : {}).links ?? {};
const host = (u: string | null | undefined) => {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};
const normName = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const yamlFor = new Map<string, { id: string; how: string }>();
for (const y of yamlApps()) {
  if (y.id === "xero") continue;
  if (y.id in xw) {
    // One catalogue app can have several Xero listings (e.g. Cin7 Core and Cin7 Omni; reviewed 23 Nov 2026).
    for (const l of [xw[y.id]].flat()) if (l) yamlFor.set(l, { id: y.id, how: "reviewed crosswalk" });
    continue;
  }
  const byName = appRows.filter((r) => normName(r.app_name!) === normName(y.name));
  const byHost = appRows.filter((r) => host(r.website) && host(r.website) === host(y.website));
  const pick = byName.length === 1 ? byName[0] : byHost.length === 1 ? byHost[0] : null;
  if (pick) yamlFor.set(pick.app_id!, { id: y.id, how: byName.length === 1 ? "exact name" : "same website" });
  else notes.push(`curated app ${y.id} (${y.name}) has no single directory match (${byName.length} by name, ${byHost.length} by website): add it to ${xwFile}`);
}

// ---------- listing pages ----------
type Listing = {
  name?: string;
  shortDescription?: string;
  listedDate?: string;
  hasFreeTrial?: boolean;
  freeTrialDurationDays?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  reviewSummary?: { ratingCounts?: { rating: number; count: number }[] } | null;
  functions?: { id: string; name: string }[];
  industries?: { id: string; name: string }[];
  regions?: { countryCode: string }[];
  supportedRegions?: { countryCode: string }[];
  languages?: { localeIdentifier: string }[];
  jtbdTasks?: { code: string; name: string }[];
  dataFlow?: { name: string; flow: string }[];
};
function listing(slug: string | null): { L: Listing | null; status: DirApp["listing"]["status"]; checkedAt: string | null } {
  if (!slug) return { L: null, status: "none", checkedAt: null };
  const log = fetchLog.get(slug);
  const p = path.join(RAW, `${slug}.json`);
  if (fs.existsSync(p)) return { L: JSON.parse(fs.readFileSync(p, "utf8")) as Listing, status: "read", checkedAt: log?.checked_at ?? null };
  if (log && log.http_status === "404") return { L: null, status: "missing", checkedAt: log.checked_at ?? null };
  return { L: null, status: "unread", checkedAt: log?.checked_at ?? null };
}
const uniq = <T,>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
const FLOWS = new Set(["in", "out", "exchange"]);

// ---------- tiers + awards ----------
const PERIOD: Record<string, DirTier["period"]> = { month: "month", year: "year", "per transaction": "transaction" };
const BASIS = new Set(["flat", "per_user", "per_client", "usage", "custom", "free"]);
const tiersBy = new Map<string, DirTier[]>();
for (const t of tierRows) {
  if (!ids.has(t.app_id!)) {
    problems.push(`tier ${t.tier_id} points at unknown app ${t.app_id}`);
    continue;
  }
  if (bool(t.ready_to_import) === false) {
    notes.push(`tier ${t.tier_id} not ready_to_import: skipped`);
    continue;
  }
  const isFree = bool(t.is_free_plan) === true;
  const amount = num(t.amount);
  const tier: DirTier = {
    id: t.tier_id!,
    name: t.tier_name!.trim(),
    priceRaw: nul(t.price_raw),
    amount: isFree ? (amount ?? 0) : amount,
    currency: nul(t.currency),
    period: PERIOD[t.billing_period ?? ""] ?? null,
    basis: BASIS.has(t.billing_basis_norm ?? "") ? (t.billing_basis_norm as DirTier["basis"]) : null,
    isQuote: bool(t.is_quote) === true,
    isFree,
    isTrial: bool(t.is_trial) === true,
    isFrom: bool(t.is_from_price) === true,
    minQuantity: num(t.min_quantity),
    includes: nul(t.includes_raw),
    limits: nul(t.description_raw),
    flags: nul(t.edge_case_flags)?.split(/;\s*/).filter(Boolean) ?? [],
    sourceUrl: nul(t.source_url),
    checkedAt: nul(t.checked_at) ?? nul(t.source_date),
  };
  if (tier.amount !== null && tier.amount > 0 && !tier.currency) tier.flags.push("currency unknown: not converted, not compared");
  tiersBy.set(t.app_id!, [...(tiersBy.get(t.app_id!) ?? []), tier]);
}
const awardsBy = new Map<string, DirApp["awards"]>();
for (const a of awardRows) {
  if (!ids.has(a.app_id!)) {
    problems.push(`award ${a.award_id} points at unknown app ${a.app_id}`);
    continue;
  }
  const ev = a.evidence_status === "verified" ? "verified" : "source-reported";
  awardsBy.set(a.app_id!, [
    ...(awardsBy.get(a.app_id!) ?? []),
    { id: a.award_id!, program: a.award_program!, year: num(a.award_year), category: nul(a.award_category), result: a.result!, evidence: ev, sourceUrl: nul(a.source_url) },
  ]);
}
const researched = new Map<string, { statement: string; lineItem: string }[]>();
for (const m of mapRows) {
  if (m.mapping_status !== "source-reported" || !ids.has(m.app_id!) || bool(m.ready_to_import) === false) continue;
  researched.set(m.app_id!, uniq([...(researched.get(m.app_id!) ?? []), { statement: m.statement!, lineItem: m.fs_line_item_legacy! }], (x) => x.statement + "|" + x.lineItem));
}

// ---------- assemble ----------
const out: DirApp[] = [];
let asOf = "";
for (const r of appRows) {
  const slug = nul(r.xero_listing_slug);
  const { L, status, checkedAt } = listing(slug);
  if (checkedAt && checkedAt > asOf) asOf = checkedAt;
  const dist = L?.reviewSummary?.ratingCounts ? Object.fromEntries(L.reviewSummary.ratingCounts.map((c) => [String(c.rating), c.count])) : null;
  const wbValue = num(r.xero_rating);
  const wbCount = num(r.xero_reviews);
  const fromListing = Boolean(L && (L.rating !== undefined || L.reviewCount !== undefined));
  const tiers = (tiersBy.get(r.app_id!) ?? []).sort((a, b) => a.id.localeCompare(b.id));
  const priced = tiers.some((t) => t.amount !== null);
  const pricingStatus: DirApp["pricing"]["status"] = priced ? "published" : tiers.length && tiers.every((t) => t.isQuote) ? "quote_only" : "unknown";
  const regions = L ? [...new Set([...(L.regions ?? []), ...(L.supportedRegions ?? [])].map((x) => x.countryCode.toLowerCase()))].sort() : [];
  const app: DirApp = {
    id: r.app_id!,
    name: r.app_name!.trim(),
    yamlId: yamlFor.get(r.app_id!)?.id ?? null,
    website: nul(r.website),
    listing: { url: nul(r.xero_listing_url), slug, status, checkedAt },
    rating: fromListing
      ? { value: L!.rating ?? null, count: L!.reviewCount ?? null, distribution: dist, source: "listing" }
      : wbValue !== null || wbCount !== null
        ? { value: wbValue, count: wbCount, distribution: null, source: "workbook" }
        : { value: null, count: null, distribution: null, source: "none" },
    workbookRating: { value: wbValue, count: wbCount },
    listedDate: L?.listedDate ? L.listedDate.slice(0, 10) : nul(r.listed_date),
    freeTrialDays: L ? (L.freeTrialDurationDays ?? null) : num(r.free_trial_days),
    hasFreeTrial: L ? (L.hasFreeTrial ?? null) : bool(r.free_trial_flag),
    description: nul(L?.shortDescription) ?? nul(r.description_raw),
    functions: uniq(L?.functions ?? [], (f) => f.id).map((f) => ({ id: f.id, name: f.name })),
    industries: uniq(L?.industries ?? [], (f) => f.id).map((f) => ({ id: f.id, name: f.name })),
    regions,
    languages: [...new Set((L?.languages ?? []).map((l) => l.localeIdentifier))].sort(),
    jtbd: uniq(L?.jtbdTasks ?? [], (t) => t.code).map((t) => ({ code: t.code, name: t.name.trim() })),
    dataFlow: uniq((L?.dataFlow ?? []).filter((d) => FLOWS.has(d.flow)), (d) => d.name + d.flow).map((d) => ({ object: d.name, flow: d.flow as "in" | "out" | "exchange" })),
    pricing: { status: pricingStatus, summaryRaw: nul(r.pricing_summary_raw), tiers },
    awards: (awardsBy.get(r.app_id!) ?? []).sort((a, b) => a.id.localeCompare(b.id)),
    legacy: { area: nul(r.area_legacy), industry: nul(r.industry_legacy_raw), businessSize: nul(r.business_size_legacy_raw), source: nul(r.legacy_source_label) },
    researchedLines: researched.get(r.app_id!) ?? [],
  };
  if (app.rating.value !== null && (app.rating.value < 0 || app.rating.value > 5)) problems.push(`${app.id}: rating ${app.rating.value} outside 0–5`);
  if (fromListing && wbValue !== null && app.rating.value !== null && Math.abs(wbValue - app.rating.value) >= 0.2) notes.push(`${app.id}: rating moved ${wbValue} (workbook) → ${app.rating.value} (listing now)`);
  if (L && L.name && normName(L.name) !== normName(app.name) && !normName(L.name).includes(normName(app.name))) notes.push(`${app.id}: listing is titled "${L.name}", workbook says "${app.name}"`);
  out.push(app);
}
out.sort((a, b) => a.id.localeCompare(b.id));

const file = { version: 1 as const, asOf: asOf || "unknown", sources: [`${H}/csv (workbook 17 Nov 2026)`, `${H}/enrichment_run (public Xero listing pages)`], apps: out };
const valid = DirectoryFile.safeParse(file);
if (!valid.success) problems.push(`schema: ${valid.error.issues.slice(0, 5).map((i) => i.path.join(".") + " " + i.message).join("; ")}`);

// ---------- diff vs the last build ----------
const prev = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")) as { apps: DirApp[] }) : { apps: [] };
const prevBy = new Map(prev.apps.map((a) => [a.id, JSON.stringify(a)]));
const added = out.filter((a) => !prevBy.has(a.id)).length;
const changed = out.filter((a) => prevBy.has(a.id) && prevBy.get(a.id) !== JSON.stringify(a)).length;
const removed = prev.apps.filter((a) => !out.some((o) => o.id === a.id)).map((a) => a.id);

const count = (f: (a: DirApp) => boolean) => out.filter(f).length;
const statusCount = (s: string) => count((a) => a.listing.status === s);
const report = [
  `# Directory import report`,
  ``,
  `${dry ? "**Dry run**: data/xero-apps/directory.json not written." : "Written: data/xero-apps/directory.json."} Listing data as of ${file.asOf}.`,
  ``,
  `| | count |`,
  `|---|---|`,
  `| apps imported | ${out.length} |`,
  `| quarantined records not imported | ${quarantinedIds.size} (${[...quarantinedIds].join(", ")}) |`,
  `| listing read | ${statusCount("read")} |`,
  `| listing returns 404 | ${statusCount("missing")} |`,
  `| no Xero listing | ${statusCount("none")} |`,
  `| listing not read yet | ${statusCount("unread")} |`,
  `| with Xero reviews (rating counts) | ${count((a) => (a.rating.count ?? 0) > 0)} |`,
  `| listed with 0 reviews (rating shown as 0, treated as no rating) | ${count((a) => a.rating.count === 0)} |`,
  `| with Xero functions | ${count((a) => a.functions.length > 0)} |`,
  `| with industries | ${count((a) => a.industries.length > 0)} |`,
  `| with regions | ${count((a) => a.regions.length > 0)} |`,
  `| with languages | ${count((a) => a.languages.length > 0)} |`,
  `| with Xero data flows | ${count((a) => a.dataFlow.length > 0)} |`,
  `| with jobs-to-be-done | ${count((a) => a.jtbd.length > 0)} |`,
  `| pricing published | ${count((a) => a.pricing.status === "published")} |`,
  `| pricing quote only | ${count((a) => a.pricing.status === "quote_only")} |`,
  `| pricing unknown | ${count((a) => a.pricing.status === "unknown")} |`,
  `| tiers | ${out.reduce((s, a) => s + a.pricing.tiers.length, 0)} |`,
  `| awards (official / vendor claims) | ${out.reduce((s, a) => s + a.awards.filter((w) => w.evidence === "verified").length, 0)} / ${out.reduce((s, a) => s + a.awards.filter((w) => w.evidence !== "verified").length, 0)} |`,
  `| linked to the curated catalogue | ${count((a) => a.yamlId !== null)} of ${yamlApps().length - 1} curated apps |`,
  ``,
  `Changes vs the last build: ${added} added, ${changed} changed, ${removed.length} removed${removed.length ? ` (${removed.join(", ")})` : ""}.`,
  ``,
  `## Problems (${problems.length})`,
  ...(problems.length ? problems.map((p) => `- ${p}`) : ["None."]),
  ``,
  `## Notes (${notes.length})`,
  ...(notes.length ? notes.map((p) => `- ${p}`) : ["None."]),
  ``,
].join("\n");
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, report, "utf8");
if (!dry && !problems.length) fs.writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n", "utf8");
console.log(report.split("\n").slice(0, 32).join("\n"));
if (problems.length) {
  console.error(`\n${problems.length} problem(s): directory.json NOT written. See ${REPORT}.`);
  process.exitCode = 1;
}
