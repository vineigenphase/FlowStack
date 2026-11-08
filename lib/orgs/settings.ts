/** Per-business settings a user can change: industry (playbooks, peer matching), markets, and price-sharing consent. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auditLog, orgs } from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { recordObservations } from "@/lib/prices";

export const INDUSTRIES = [
  { key: "hospitality", label: "Hospitality" },
  { key: "retail", label: "Retail" },
  { key: "ecommerce", label: "Ecommerce" },
  { key: "professional_services", label: "Professional services" },
  { key: "construction_trades", label: "Construction and trades" },
  { key: "manufacturing", label: "Manufacturing" },
  { key: "wholesale", label: "Wholesale and distribution" },
  { key: "saas_tech", label: "Software and tech" },
  { key: "healthcare", label: "Healthcare" },
  { key: "charity", label: "Charity and non-profit" },
  { key: "other", label: "Other" },
] as const;
export const industryLabel = (k: string | null) => INDUSTRIES.find((i) => i.key === k)?.label ?? null;

export const SettingsInput = z.object({
  industry: z.enum(INDUSTRIES.map((i) => i.key) as [string, ...string[]]).nullable().optional(),
  markets: z.array(z.enum(["UK", "US", "CA", "AU"])).min(1).optional(),
  sharePrices: z.boolean().optional(),
  askAi: z.boolean().optional(),
});

export async function getSettings(orgId: string) {
  const [o] = await withOrg(orgId, (tx) => tx.select().from(orgs).where(eq(orgs.id, orgId)));
  return o ? { industry: o.industry, markets: o.markets, sharePrices: o.sharePrices, askAi: o.askAi, sample: o.sample } : null;
}

/** Saves settings. Consent changes are audited and take effect on peer prices at once (rows written or deleted). */
export async function saveSettings(orgId: string, userId: string, input: z.infer<typeof SettingsInput>) {
  const before = await getSettings(orgId);
  const set: Partial<typeof orgs.$inferInsert> = {};
  if (input.industry !== undefined) set.industry = input.industry;
  if (input.markets) set.markets = input.markets;
  if (input.sharePrices !== undefined) set.sharePrices = input.sharePrices;
  if (input.askAi !== undefined) set.askAi = input.askAi;
  if (Object.keys(set).length) await withOrg(orgId, (tx) => tx.update(orgs).set(set).where(eq(orgs.id, orgId)));
  if (input.sharePrices !== undefined && input.sharePrices !== before?.sharePrices) {
    const db = await adminDb();
    await db.insert(auditLog).values({ actor: userId, action: input.sharePrices ? "share_prices.on" : "share_prices.off", target: { org_id: orgId } });
  }
  if (input.askAi !== undefined && input.askAi !== before?.askAi) {
    const db = await adminDb();
    await db.insert(auditLog).values({ actor: userId, action: input.askAi ? "ask_ai.on" : "ask_ai.off", target: { org_id: orgId } });
  }
  if (input.sharePrices !== undefined || input.industry !== undefined) await recordObservations(orgId);
  // Markets decide which apps are candidates: re-rank from stored figures (no Xero calls).
  if (input.markets && before && input.markets.slice().sort().join() !== before.markets.slice().sort().join()) {
    const { recompute } = await import("@/lib/sync/refresh");
    await recompute(orgId);
  }
  return getSettings(orgId);
}
