/**
 * ENGINE-V2 Phase 0: the canonical shape of one Xero app listing, the source of truth for engine v2 inputs.
 * Built by scripts/appdb/adapt.ts from the owner's app database (data/xero-apps/, see SOURCE.md). Phase 1 loads it
 * into the global table xero_app_listings (migration 0025, read-only to the app role).
 *
 * Rules (ENGINE-V2.md + CLAUDE.md §6): a row that fails this schema is rejected, never patched. Unknown stays null:
 * price_gbp null = quote, unknown or not in pounds (never converted); rating_avg null = no rating (not a low one).
 */
import { z } from "zod";

export const MARKETS = ["UK", "US", "CA", "AU"] as const;

export const PricingTier = z.object({
  name: z.string().min(1),
  /** Pounds per period. null = quote-only, not published, or priced in another currency (never converted). 0 = an explicit free plan. */
  price_gbp: z.number().nonnegative().nullable(),
  period: z.enum(["month", "year", "one_off"]),
  unit: z.enum(["org", "user", "employee", "transaction", "other"]),
  included: z.string().optional(),
  limits: z.string().optional(),
});
export type PricingTier = z.infer<typeof PricingTier>;

export const Award = z.object({
  name: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  /** "unknown" when the source doesn't say which region's award it was (never guessed). */
  region: z.string().min(1),
  level: z.enum(["winner", "finalist"]),
});
export type Award = z.infer<typeof Award>;

export const XeroAppListing = z
  .object({
    listing_id: z.string().regex(/^(xa|ext)-[a-z0-9-]+$/),
    name: z.string().min(1).refine((s) => s === s.trim(), "name has leading/trailing spaces"),
    website: z.string().min(1).nullable(),
    xero_categories: z.array(z.string().min(1)),
    xero_functions: z.array(z.string().min(1)),
    description: z.string().nullable(),
    rating_avg: z.number().min(0).max(5).nullable(),
    rating_count: z.number().int().nonnegative().nullable(),
    review_count: z.number().int().nonnegative().nullable(),
    pricing_tiers: z.array(PricingTier),
    awards: z.array(Award),
    markets: z.array(z.enum(MARKETS)),
    source_url: z.string().url().nullable(),
    captured_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((r) => !(r.rating_avg !== null && r.rating_count === 0), "a rating with zero reviews");
export type XeroAppListing = z.infer<typeof XeroAppListing>;
