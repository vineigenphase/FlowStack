/** Hand-curated catalogue (catalog/*.yaml), validated with Zod on load and cached per process. */
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const ROOT = path.resolve(process.cwd(), "catalog");

const list = <T extends z.ZodType>(s: T) => z.array(s);
const strs = z.array(z.string()).default([]);

export const AccountCategory = z.object({
  key: z.string(),
  label: z.string(),
  statement: z.enum(["pl", "bs"]),
  revenue: z.boolean().default(false),
  match: z.object({
    types: strs,
    reporting_codes: strs,
    name_any: strs,
    system_account: z.string().optional(),
    type_only: z.boolean().default(false),
    /** v1.1 M: the type suggests this category but a specific name should win (0.76). */
    type_default: z.boolean().default(false),
  }),
  /** v1.1 M: the tax rate this kind of account normally carries. A disagreeing account loses 0.15 confidence. */
  expected_tax: z.enum(["no_vat", "vat"]).optional(),
});
export type AccountCategory = z.infer<typeof AccountCategory>;

export const AppCategory = z.object({ key: z.string(), label: z.string() });
export type AppCategory = z.infer<typeof AppCategory>;

export const Rule = z.object({
  id: z.string(),
  version: z.number().int().default(1),
  account_categories: z.array(z.string()).min(1),
  app_categories: strs,
  /** Categories that, when an app in them is in use, mean the line is handled. Defaults to app_categories. */
  covered_by: z.array(z.string()).optional(),
  statements: z.array(z.enum(["pl", "bs", "cf", "trend"])).default(["pl", "bs", "cf"]),
  min_value_gbp: z.number().default(0),
  cause: z.string().optional(),
});
export type Rule = z.infer<typeof Rule>;

export const Scoring = z.object({
  weights: z.object({ strength: z.number(), fit_with_in_use: z.number(), peer_results: z.number(), price_fit: z.number() }),
  fit: z.object({ native: z.number(), via_app: z.number(), csv: z.number(), none: z.number(), no_apps: z.number() }),
  neutral: z.number().default(0.5),
});
export type Scoring = z.infer<typeof Scoring>;

const TrendRule = z.object({ threshold: z.number(), min_change: z.number() });
/** v1.1 B: trend thresholds (BACKEND §7.3). Each trend also needs a rule whose account_categories has trend:<key>. */
export const RulesFile = z.object({
  scoring: Scoring,
  rules: list(Rule),
  trends: z.object({ debtor_days: TrendRule, creditor_days: TrendRule, stock_days: TrendRule, cash_headroom_months: TrendRule }).partial().default({}),
});

export const App = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string(),
  categories: z.array(z.string()).min(1),
  markets: z.array(z.enum(["UK", "US", "CA", "AU"])).min(1),
  website: z.string().url().optional(),
  crawl: z
    .object({
      home: z.string().nullable().optional(),
      pricing: z.string().nullable().optional(),
      product: z.string().nullable().optional(),
      services: z.string().nullable().optional(),
      // v1.1 L: up to 7 pages, found once by a person and written here, never guessed.
      integrations: z.string().nullable().optional(),
      security: z.string().nullable().optional(),
      terms: z.string().nullable().optional(),
    })
    .optional(),
  fingerprints: z.array(z.string()).default([]),
  integrations: z.array(z.object({ to: z.string(), kind: z.enum(["native", "via_app", "csv"]) })).default([]),
  /** Price band this app suits, by annual revenue (£). Hand-entered, sample until verified. */
  revenue_band: z.object({ min: z.number().default(0), max: z.number().nullable().default(null) }).optional(),
  /** v1.1 L: UK company number for Companies House facts, entered by a person (8 characters, e.g. 09876543 or SC123456). */
  companies_house: z.string().regex(/^[A-Z0-9]{8}$/).optional(),
  sample: z.boolean().default(true),
  source: z.string().optional(),
});
export type App = z.infer<typeof App>;

export const Market = z.object({
  key: z.enum(["UK", "US", "CA", "AU"]),
  label: z.string(),
  currency: z.string(),
  swaps: z.array(z.object({ category: z.string(), from: z.string(), to: z.string() })).default([]),
});
export const Essential = z.object({
  key: z.string(),
  market: z.enum(["UK", "US", "CA", "AU"]),
  label: z.string(),
  cadence: z.enum(["monthly", "quarterly", "yearly"]),
  note: z.string().optional(),
  sample: z.boolean().default(true),
});

const cache = new Map<string, unknown>();

function loadFile<T extends z.ZodType>(name: string, schema: T): z.infer<T> {
  const key = `${ROOT}/${name}`;
  if (!cache.has(key)) {
    const raw = parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
    const res = schema.safeParse(raw);
    if (!res.success) throw new Error(`catalog/${name} is invalid: ${z.prettifyError(res.error)}`);
    cache.set(key, res.data);
  }
  return cache.get(key) as z.infer<T>;
}

export const accountCategories = () => loadFile("account-categories.yaml", list(AccountCategory));
export const appCategories = () => loadFile("app-categories.yaml", list(AppCategory));
export const rulesFile = () => loadFile("rules.yaml", RulesFile);
export const apps = () => loadFile("apps.yaml", list(App));
export const markets = () => loadFile("markets.yaml", list(Market));
export const essentials = () => loadFile("essentials.yaml", list(Essential));
/** v1.1 M: reporting code prefix → category, and extra name synonyms per category (BACKEND §5). */
export const reportingCodes = () => loadFile("reporting-codes.yaml", z.record(z.string(), z.string()));
export const accountSynonyms = () => loadFile("account-synonyms.yaml", z.record(z.string(), z.array(z.string())));
export const mappingCatalog = () => ({ reportingCodes: reportingCodes(), synonyms: accountSynonyms() });

export function clearCatalogCache() {
  cache.clear();
}

/** Cross-file checks: every referenced key exists. Run in tests and on seed. */
export function validateCatalog(): string[] {
  const mapCats = new Set(accountCategories().map((c) => c.key));
  const mapErrs: string[] = [];
  for (const [code, cat] of Object.entries(reportingCodes())) if (!mapCats.has(cat)) mapErrs.push(`reporting-codes.yaml: ${code} → unknown category ${cat}`);
  for (const cat of Object.keys(accountSynonyms())) if (!mapCats.has(cat)) mapErrs.push(`account-synonyms.yaml: unknown category ${cat}`);
  if (mapErrs.length) return mapErrs;
  const errs: string[] = [];
  const acc = new Set(accountCategories().map((c) => c.key));
  const appCats = new Set(appCategories().map((c) => c.key));
  const appIds = new Set(apps().map((a) => a.id));
  const seen = new Set<string>();
  for (const c of accountCategories()) {
    if (seen.has(c.key)) errs.push(`duplicate account category ${c.key}`);
    seen.add(c.key);
  }
  for (const r of rulesFile().rules) {
    for (const k of r.account_categories) {
      const trend = k.startsWith("trend:") ? k.slice(6) : null;
      if (trend ? !(trend in rulesFile().trends) : !acc.has(k)) errs.push(`rule ${r.id}: unknown ${trend ? "trend" : "account category"} ${k}`);
    }
    for (const k of r.app_categories) if (!appCats.has(k)) errs.push(`rule ${r.id}: unknown app category ${k}`);
    for (const k of r.covered_by ?? []) if (!r.app_categories.includes(k)) errs.push(`rule ${r.id}: covered_by ${k} is not one of its app_categories`);
  }
  const pats = new Map<string, string>();
  for (const a of apps()) {
    for (const k of a.categories) if (!appCats.has(k) && k !== "accounting") errs.push(`app ${a.id}: unknown category ${k}`);
    for (const i of a.integrations) if (!appIds.has(i.to) && i.to !== "xero") errs.push(`app ${a.id}: integration to unknown app ${i.to}`);
    for (const p of a.fingerprints) {
      if (pats.has(p)) errs.push(`fingerprint "${p}" used by ${pats.get(p)} and ${a.id}`);
      pats.set(p, a.id);
    }
  }
  return errs;
}
