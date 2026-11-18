/**
 * The app directory database (catalog/directory.json), built by scripts/catalogue/build-directory.ts from the
 * reviewed workbook (docs/app-catalogue-handoff/) and the public Xero App Store listing pages.
 *
 * Rules (owner brief + handoff, 17–18 Nov 2026):
 * - Identity is `id` (the reviewed crosswalk id, `xa-<listing slug>` / `ext-<name>`), never the name: names collide
 *   (Employment Hero ×2) and have whitespace variants. `yamlId` links to the hand-curated catalog/apps.yaml entry.
 * - Unknown is not zero and not false: null rating ≠ low rating; a tier with amount null is unknown/quote, never free;
 *   currency null is never guessed from "$"; empty regions/languages = not read, not "unsupported".
 * - Ratings and review counts are stored exactly as Xero shows them. Derived scores live elsewhere (lib/rank).
 * - Functions, industries, regions, languages, jobs-to-be-done and data flows come straight from the Xero listing.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const Named = z.object({ id: z.string(), name: z.string() });

export const DirTier = z.object({
  id: z.string(),
  name: z.string(),
  priceRaw: z.string().nullable(),
  /** null = unknown or quote. 0 only for an explicit free plan. */
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  period: z.enum(["month", "year", "transaction"]).nullable(),
  basis: z.enum(["flat", "per_user", "per_client", "usage", "custom", "free"]).nullable(),
  isQuote: z.boolean(),
  isFree: z.boolean(),
  isTrial: z.boolean(),
  isFrom: z.boolean(),
  minQuantity: z.number().nullable(),
  includes: z.string().nullable(),
  limits: z.string().nullable(),
  flags: z.array(z.string()),
  sourceUrl: z.string().nullable(),
  checkedAt: z.string().nullable(),
});
export type DirTier = z.infer<typeof DirTier>;

export const DirAward = z.object({
  id: z.string(),
  program: z.string(),
  year: z.number().nullable(),
  category: z.string().nullable(),
  result: z.string(),
  /** "verified" = an official Xero record; "source-reported" = a vendor's own claim. Kept apart, never merged. */
  evidence: z.enum(["verified", "source-reported"]),
  sourceUrl: z.string().nullable(),
});

export const DirApp = z.object({
  id: z.string().regex(/^(xa|ext)-[a-z0-9-]+$/),
  name: z.string(),
  yamlId: z.string().nullable(),
  website: z.string().nullable(),
  listing: z.object({
    url: z.string().nullable(),
    slug: z.string().nullable(),
    /** read = listing page parsed; missing = page returned 404; none = no Xero listing; unread = not fetched yet. */
    status: z.enum(["read", "missing", "none", "unread"]),
    checkedAt: z.string().nullable(),
  }),
  /** Exactly as the Xero listing shows it (falls back to the workbook's value, with source saying so). */
  rating: z.object({
    value: z.number().nullable(),
    count: z.number().int().nullable(),
    /** Stars 0–5 → number of reviews, from the listing's review summary. */
    distribution: z.record(z.string(), z.number()).nullable(),
    source: z.enum(["listing", "workbook", "none"]),
  }),
  workbookRating: z.object({ value: z.number().nullable(), count: z.number().int().nullable() }),
  listedDate: z.string().nullable(),
  freeTrialDays: z.number().nullable(),
  hasFreeTrial: z.boolean().nullable(),
  description: z.string().nullable(),
  functions: z.array(Named),
  industries: z.array(Named),
  regions: z.array(z.string()),
  languages: z.array(z.string()),
  jtbd: z.array(z.object({ code: z.string(), name: z.string() })),
  dataFlow: z.array(z.object({ object: z.string(), flow: z.enum(["in", "out", "exchange"]) })),
  pricing: z.object({
    status: z.enum(["published", "quote_only", "unknown"]),
    summaryRaw: z.string().nullable(),
    tiers: z.array(DirTier),
  }),
  awards: z.array(DirAward),
  /** Workbook (legacy) labels, kept next to the Xero data for comparison. */
  legacy: z.object({ area: z.string().nullable(), industry: z.string().nullable(), businessSize: z.string().nullable(), source: z.string().nullable() }),
  /** Mappings the workbook researched by hand (apps without a Xero listing), source-reported, never verified. */
  researchedLines: z.array(z.object({ statement: z.string(), lineItem: z.string() })),
});
export type DirApp = z.infer<typeof DirApp>;

export const DirectoryFile = z.object({
  version: z.literal(1),
  /** Latest listing read date in the file (not the build time, so a rebuild with the same inputs is byte-identical). */
  asOf: z.string(),
  sources: z.array(z.string()),
  apps: z.array(DirApp),
});
export type DirectoryFile = z.infer<typeof DirectoryFile>;

let cache: DirectoryFile | null = null;
const FILE = () => path.resolve(process.cwd(), "catalog", "directory.json");

/** The directory; an empty one when the file hasn't been built (engine falls back to the curated catalogue only). */
export function directory(): DirectoryFile {
  if (cache) return cache;
  if (!fs.existsSync(FILE())) return (cache = { version: 1, asOf: "", sources: [], apps: [] });
  const res = DirectoryFile.safeParse(JSON.parse(fs.readFileSync(FILE(), "utf8")));
  if (!res.success) throw new Error(`catalog/directory.json is invalid: ${z.prettifyError(res.error)}`);
  return (cache = res.data);
}

export function clearDirectoryCache() {
  cache = null;
}
