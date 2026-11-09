/**
 * Peer prices (CLAUDE.md §7.3b "Where prices come from" #1, §2.2): what businesses actually pay each app, from
 * their own bills. Plain statistics (median, p25–p75), never a model, and only over 10+ consenting businesses.
 *
 * - Opt-in: a business's bills count only when `orgs.share_prices` is on. Turning it off deletes its rows.
 * - Sample orgs never count.
 * - price_observations is unreadable to the app role; only aggregates of k+ distinct businesses leave this file.
 *
 * v1.1 G: NOT IN 1.0. Off unless PEER_PRICES_ENABLED=true; when off nothing is collected (any rows are deleted) and
 * nothing is shown. TODO(CHANGES-v1.1.md §4 item 2): needs written sign-off from a lawyer and Xero's partner team.
 * If enabled later: range only (p25–p75) rounded to the nearest £5, never a single value or a count below 10.
 */
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { detectedApps, orgs, priceObservations, statements } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import type { PeerBand } from "@/lib/checkins/evaluate";
import { env } from "@/lib/env";

export const peerPricesEnabled = () => env().PEER_PRICES_ENABLED;

export const K = 10;

export const SIZE_BANDS = [
  { key: "under_1m", label: "under £1m revenue", max: 1_000_000 },
  { key: "1m_5m", label: "£1m–£5m revenue", max: 5_000_000 },
  { key: "5m_20m", label: "£5m–£20m revenue", max: 20_000_000 },
  { key: "20m_plus", label: "£20m+ revenue", max: Infinity },
] as const;

/** Annualised revenue → size band. Null when the period is too short (< 1 month) to annualise honestly. */
export function sizeBand(revenue: number, from: string | null, to: string): string | null {
  if (!from) return null;
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (days < 28 || revenue <= 0) return null;
  const annual = (revenue / days) * 365;
  return SIZE_BANDS.find((b) => annual < b.max)!.key;
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round((sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo)) * 100) / 100;
}

const median = (v: number[]) => percentile([...v].sort((a, b) => a - b), 0.5);

/** One number per business (its median monthly bill), then the band across businesses. Null under k. */
export function bandOf(perOrgMonthly: Map<string, number[]>, k = K): PeerBand | null {
  const per = [...perOrgMonthly.values()].filter((v) => v.length).map(median).sort((a, b) => a - b);
  if (per.length < k) return null;
  return { n: per.length, p25: percentile(per, 0.25), median: percentile(per, 0.5), p75: percentile(per, 0.75) };
}

async function orgSizeBand(orgId: string): Promise<string | null> {
  const db = await adminDb();
  const pl = await db.select().from(statements).where(and(eq(statements.orgId, orgId), eq(statements.kind, "pl")));
  const s = pl.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return s ? sizeBand(s.totals.revenue ?? 0, s.periodFrom, s.periodTo) : null;
}

/** Rewrite this org's observations from its detected apps' monthly bills (or delete them without consent). */
export async function recordObservations(orgId: string) {
  const db = await adminDb();
  const [o] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  await db.delete(priceObservations).where(eq(priceObservations.orgId, orgId));
  if (!peerPricesEnabled() || !o || !o.sharePrices || o.sample) return 0;
  const band = await orgSizeBand(orgId);
  const det = await db.select().from(detectedApps).where(eq(detectedApps.orgId, orgId));
  const rows = det.flatMap((d) =>
    Object.entries((d.evidence as { monthly?: Record<string, number> }).monthly ?? {})
      .filter(([, v]) => v > 0)
      .map(([month, amount]) => ({ appId: d.appId, orgId, month, amount, sizeBand: band, industry: o.industry })),
  );
  if (rows.length) await db.insert(priceObservations).values(rows);
  return rows.length;
}

const yearAgo = () => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12);
  return `${d.toISOString().slice(0, 7)}-01`;
};

async function perOrg(appId: string, where: { sizeBand?: string; excludeOrg?: string } = {}) {
  const db = await adminDb();
  const conds = [eq(priceObservations.appId, appId), gte(priceObservations.month, yearAgo())];
  if (where.sizeBand) conds.push(eq(priceObservations.sizeBand, where.sizeBand));
  if (where.excludeOrg) conds.push(ne(priceObservations.orgId, where.excludeOrg));
  // Join back to orgs so withdrawn consent or a sample flag removes a business immediately.
  const rows = await db
    .select({ orgId: priceObservations.orgId, amount: priceObservations.amount })
    .from(priceObservations)
    .innerJoin(orgs, and(eq(orgs.id, priceObservations.orgId), eq(orgs.sharePrices, true), eq(orgs.sample, false)))
    .where(and(...conds));
  const m = new Map<string, number[]>();
  for (const r of rows) m.set(r.orgId, [...(m.get(r.orgId) ?? []), r.amount]);
  return m;
}

/**
 * The range similar businesses pay for an app: same size band when 10+ businesses are in it, else all sizes.
 * The asking business is left out of its own comparison. Null when fewer than 10.
 */
export async function peerBand(appId: string, orgId?: string): Promise<(PeerBand & { scope: string }) | null> {
  if (!peerPricesEnabled()) return null;
  const band = orgId ? await orgSizeBand(orgId) : null;
  if (band) {
    const b = bandOf(await perOrg(appId, { sizeBand: band, excludeOrg: orgId }));
    if (b) return { ...b, scope: SIZE_BANDS.find((x) => x.key === band)!.label };
  }
  const all = bandOf(await perOrg(appId, { excludeOrg: orgId }));
  return all ? { ...all, scope: "all sizes" } : null;
}

/** Bands for many apps at once (directory/dossier pages). */
export async function peerBands(appIds: string[]) {
  const out = new Map<string, PeerBand & { scope: string }>();
  if (!appIds.length || !peerPricesEnabled()) return out;
  const db = await adminDb();
  const rows = await db
    .select({ appId: priceObservations.appId, orgId: priceObservations.orgId, amount: priceObservations.amount })
    .from(priceObservations)
    .innerJoin(orgs, and(eq(orgs.id, priceObservations.orgId), eq(orgs.sharePrices, true), eq(orgs.sample, false)))
    .where(and(inArray(priceObservations.appId, appIds), gte(priceObservations.month, yearAgo())));
  const byApp = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    const m = byApp.get(r.appId) ?? new Map<string, number[]>();
    m.set(r.orgId, [...(m.get(r.orgId) ?? []), r.amount]);
    byApp.set(r.appId, m);
  }
  for (const [appId, m] of byApp) {
    const b = bandOf(m);
    if (b) out.set(appId, { ...b, scope: "all sizes" });
  }
  return out;
}
