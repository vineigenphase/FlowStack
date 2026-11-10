/**
 * Vendor facts from Companies House (BACKEND.md §11, v1.1 L). The UK public register, free API:
 *   GET /company/{number}                               → incorporation date, status
 *   GET /company/{number}/persons-with-significant-control → who controls it, and when that changed
 * Official registry data, so it is stored as `verified` with the register page as the source (the one
 * exception to "never auto-promote"). Company numbers are written into apps.yaml by a person, never guessed.
 * Needs COMPANIES_HOUSE_API_KEY (HTTP basic auth, key as the username).
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { appFacts, apps as appsT } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { apps as catalogApps } from "@/lib/catalog/load";

const API = "https://api.company-information.service.gov.uk";
export const registerUrl = (n: string) => `https://find-and-update.company-information.service.gov.uk/company/${n}`;

const Company = z.object({ company_number: z.string(), company_name: z.string(), date_of_creation: z.string().optional(), company_status: z.string().optional() });
const Pscs = z.object({ items: z.array(z.object({ name: z.string().optional(), notified_on: z.string().optional(), ceased_on: z.string().optional() })).default([]) });

export type VendorRecord = { number: string; name: string; incorporated: string | null; status: string | null; controlChanges: number; lastControlChange: string | null };

/** Pure: a register record → the facts we show. */
export function vendorFacts(r: VendorRecord) {
  return [
    { field: "vendor_incorporated", value: r.incorporated },
    { field: "vendor_ownership_changes", value: { changes: r.controlChanges, last: r.lastControlChange } },
  ].filter((f) => f.value !== null);
}

export async function fetchVendor(number: string, deps: { fetchImpl?: typeof fetch; key?: string } = {}): Promise<VendorRecord | null> {
  const key = deps.key ?? env().COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  const f = deps.fetchImpl ?? fetch;
  const headers = { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "user-agent": "FlowStack catalogue (vendor facts)" };
  const c = await f(`${API}/company/${encodeURIComponent(number)}`, { headers });
  if (!c.ok) return null;
  const company = Company.parse(await c.json());
  const p = await f(`${API}/company/${encodeURIComponent(number)}/persons-with-significant-control`, { headers });
  const pscs = p.ok ? Pscs.parse(await p.json()).items : [];
  // A change of control = a controller added after incorporation, or one that ceased.
  const changes = pscs.flatMap((x) => [x.notified_on && x.notified_on !== company.date_of_creation ? x.notified_on : null, x.ceased_on ?? null]).filter((d): d is string => !!d).sort();
  return { number: company.company_number, name: company.company_name, incorporated: company.date_of_creation ?? null, status: company.company_status ?? null, controlChanges: changes.length, lastControlChange: changes.at(-1) ?? null };
}

/** Refresh one app's register facts. Skips apps with no company number (most non-UK vendors). */
export async function refreshVendor(appId: string, deps: { fetchImpl?: typeof fetch; key?: string; now?: Date } = {}) {
  const app = catalogApps().find((a) => a.id === appId);
  if (!app?.companies_house) return { appId, skipped: "no company number" as const };
  const r = await fetchVendor(app.companies_house, deps);
  if (!r) return { appId, skipped: "not available" as const };
  const db = await adminDb();
  await db.insert(appsT).values({ id: app.id, name: app.name, website: app.website ?? null, categories: app.categories, markets: app.markets, crawl: app.crawl ?? null, sample: app.sample }).onConflictDoNothing();
  for (const f of vendorFacts(r)) {
    const row = { appId, field: f.field, value: f.value, state: "verified" as const, quote: null, sourceUrl: registerUrl(r.number), checkedAt: deps.now ?? new Date(), checkedBy: "companies_house", sample: false };
    await db.insert(appFacts).values(row).onConflictDoUpdate({ target: [appFacts.appId, appFacts.field], set: row });
  }
  const stored = await db.select().from(appFacts).where(and(eq(appFacts.appId, appId), eq(appFacts.checkedBy, "companies_house")));
  return { appId, facts: stored.length };
}
