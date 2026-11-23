/**
 * ENGINE-V2 industry_fit (owner 23 Nov 2026; CLAUDE.md §7.3 exclusions). From the Xero listing's industries and the
 * business's industry (catalog/industry-map.yaml):
 *   - lists the business's industry                                     → 1
 *   - lists only general ones (Professional services, Accounting) instead → broad_only (weak fit)
 *   - lists industries, none the business's and none general             → excluded ("built for Automotive")
 *   - business industry not set or not on Xero; app lists none            → missing (neutral)
 * The app already in use is never excluded.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ScoringV2 } from "@/lib/catalog/load";
import type { V2App } from "./apps";
import { missingInput, type Input } from "./part";

export type IndustryMap = { industries: Record<string, string[]>; broad: string[] };

let cache: IndustryMap | null = null;
export function industryMap(): IndustryMap {
  cache ??= parseYaml(fs.readFileSync(path.resolve(process.cwd(), "catalog/industry-map.yaml"), "utf8")) as IndustryMap;
  return cache;
}

export function industryFit(app: V2App, industry: string | null, s: ScoringV2, map: IndustryMap = industryMap()): { input: Input } | { exclude: string } {
  const want = industry ? (map.industries[industry] ?? []) : [];
  if (!industry || industry === "other") return { input: missingInput(s.neutral, "The business's industry isn't set") };
  if (!want.length) return { input: missingInput(s.neutral, "Xero has no industry matching this business") };
  if (!app.industries.length) return { input: missingInput(s.neutral, app.listing ? "The Xero listing names no industries" : "No Xero listing") };
  const source = app.listing ? { label: "Xero App Store listing (industries)", url: app.listing.source_url ?? undefined, capturedAt: app.listing.captured_at } : undefined;
  const hit = app.industries.filter((i) => want.includes(i));
  if (hit.length) return { input: { raw: { listed: app.industries, matched: hit }, normalised: 1, missing: false, note: `Built for ${hit.join(", ")}`, source } };
  const broad = app.industries.filter((i) => map.broad.includes(i));
  if (broad.length) return { input: { raw: { listed: app.industries, matched: [] }, normalised: s.industry_fit.broad_only, missing: false, note: `Listed for ${app.industries.join(", ")}, not ${want.join("/")}`, source } };
  return { exclude: `Built for ${app.industries.join(", ")}, not ${want.join("/")}` };
}
