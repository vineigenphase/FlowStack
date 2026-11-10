/**
 * App facts with states (BACKEND.md §8.2). Nothing is ever estimated: a field with no confirmed value
 * is "missing" and shows as "Not published · we're checking".
 */
import { appFacts, apps as appsT } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { apps as catalogApps } from "./load";

export const FACT_FIELDS = [
  "price_model",
  "price_from_gbp",
  "setup_fee",
  "quote_only",
  "min_term",
  "notice_period",
  "auto_renew",
  "data_export",
  "posts_to_xero_as",
  "tracking_categories",
  "security_certs",
  "data_location",
  "support_hours",
  "days_to_go_live",
] as const;
/** v1.1 L: from Companies House only (verified, register as source). Never crawled or extracted from vendor pages. */
export const REGISTRY_FIELDS = ["vendor_incorporated", "vendor_ownership_changes"] as const;
export type FactField = (typeof FACT_FIELDS)[number] | (typeof REGISTRY_FIELDS)[number];
/** Everything shown on a dossier: crawled facts, then register facts. */
export const DISPLAY_FIELDS: readonly FactField[] = [...FACT_FIELDS, ...REGISTRY_FIELDS];

export const FACT_LABELS: Record<FactField, string> = {
  price_model: "Pricing model",
  price_from_gbp: "Price from (£/month)",
  setup_fee: "Setup fee",
  quote_only: "Quote only",
  min_term: "Minimum term",
  notice_period: "Notice period",
  auto_renew: "Auto-renews",
  data_export: "Data export on exit",
  posts_to_xero_as: "Posts to Xero as",
  tracking_categories: "Tracking categories",
  security_certs: "Security certifications",
  data_location: "Data location",
  support_hours: "Support hours",
  days_to_go_live: "Days to go live",
  vendor_incorporated: "Company founded",
  vendor_ownership_changes: "Changes of control",
};

export type FactState = "verified" | "found" | "missing" | "conflicting" | "stale";

export type FactRow = {
  field: string;
  value: unknown;
  state: FactState;
  quote: string | null;
  sourceUrl: string | null;
  checkedAt: Date | null;
  sample: boolean;
};

/** What the UI shows for a fact. Missing never shows a value. */
export function displayFact(f: FactRow | undefined, field: FactField, now = new Date()) {
  const base = { field, label: FACT_LABELS[field] };
  if (!f || f.state === "missing") return { ...base, state: "missing" as const, value: null, display: "Not published · we're checking", source_url: f?.sourceUrl ?? null, checked_at: f?.checkedAt ?? null, sample: f?.sample ?? true };
  const age = f.checkedAt ? Math.floor((now.getTime() - f.checkedAt.getTime()) / 86_400_000) : null;
  const note =
    f.state === "verified" ? "Checked by our team" : f.state === "found" ? "From the vendor's site" : f.state === "stale" ? `Last confirmed ${age} days ago` : "Sources disagree · we're checking";
  return { ...base, state: f.state, value: f.value, display: note, quote: f.quote, source_url: f.sourceUrl, checked_at: f.checkedAt, sample: f.sample };
}

/** Seed: every catalogue app, every field, state "missing" (sample). Never overwrites real facts. */
export async function seedFacts() {
  const db = await adminDb();
  let n = 0;
  for (const a of catalogApps()) {
    await db
      .insert(appsT)
      .values({ id: a.id, name: a.name, website: a.website ?? null, categories: a.categories, markets: a.markets, crawl: a.crawl ?? null, sample: a.sample })
      .onConflictDoNothing();
    for (const field of FACT_FIELDS) {
      const r = await db
        .insert(appFacts)
        .values({ appId: a.id, field, value: null, state: "missing", checkedBy: "seed", sample: true })
        .onConflictDoNothing()
        .returning({ f: appFacts.field });
      n += r.length;
    }
  }
  return n;
}
