/**
 * Apps in use (BACKEND.md §6). Bills (summaryOnly) + bank spend for the last 12 months → per-supplier
 * monthly aggregates → fingerprint match → detected_apps. Individual transactions are never persisted.
 *
 * Incremental: If-Modified-Since is used as a cheap "anything changed?" probe. Aggregates can't be
 * patched with deltas (the original rows are gone), so when something changed the 12-month window
 * is rebuilt in full; when nothing changed we skip both list calls' full pull.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { accountMaps, accounts, detectedApps, fingerprints, supplierSpend, syncCursors } from "@/db/schema";
import { withOrg, type Db } from "@/lib/db/client";
import { apps as catalogApps } from "@/lib/catalog/load";
import { enqueueAll, type QueueItem } from "@/lib/queue/enqueue";
import type { XeroClient } from "@/lib/xero/client";
import { bills, spendTransactions } from "@/lib/xero/endpoints";
import { monthsBack } from "@/lib/sync/periods";
import { SpendAggregator, type SupplierHints } from "./aggregate";
import { matchSupplier, type Fingerprint, type Match } from "./match";

export function catalogFingerprints(): Fingerprint[] {
  return catalogApps().flatMap((a) => a.fingerprints.map((pattern) => ({ appId: a.id, pattern })));
}

export function dedupeFingerprints(fps: Fingerprint[]): Fingerprint[] {
  const seen = new Set<string>();
  return fps.filter((f) => (seen.has(f.pattern) ? false : (seen.add(f.pattern), true)));
}

async function changedSince(c: XeroClient, since: Date, cursor: Date | null) {
  if (!cursor) return true;
  for await (const page of bills(c, since, cursor)) if (page.length) return true;
  for await (const page of spendTransactions(c, since, cursor)) if (page.length) return true;
  return false;
}

export async function syncAppsInUse(orgId: string, client: XeroClient, opts: { asAt: string; now?: Date }) {
  const started = opts.now ?? new Date();
  const since = monthsBack(opts.asAt, 12);
  const sinceDate = new Date(since + "T00:00:00Z");

  const cursor = await withOrg(orgId, async (tx) => {
    const rows = await tx.select().from(syncCursors).where(eq(syncCursors.orgId, orgId));
    const inv = rows.find((r) => r.endpoint === "invoices")?.modifiedSince ?? null;
    const bank = rows.find((r) => r.endpoint === "banktransactions")?.modifiedSince ?? null;
    return inv && bank ? (inv < bank ? inv : bank) : null;
  });

  let hints: SupplierHints | null = null;
  if (await changedSince(client, sinceDate, cursor)) {
    const agg = new SpendAggregator();
    for await (const page of bills(client, sinceDate)) agg.addBills(page);
    for await (const page of spendTransactions(client, sinceDate)) agg.addSpend(page);
    const rows = agg.result();
    hints = agg.hints;
    await withOrg(orgId, async (tx) => {
      await tx.delete(supplierSpend).where(and(eq(supplierSpend.orgId, orgId), gte(supplierSpend.month, since)));
      await tx.delete(supplierSpend).where(and(eq(supplierSpend.orgId, orgId), lt(supplierSpend.month, monthsBack(opts.asAt, 24))));
      if (rows.length) await tx.insert(supplierSpend).values(rows.map((r) => ({ orgId, ...r })));
      for (const endpoint of ["invoices", "banktransactions"]) {
        await tx
          .insert(syncCursors)
          .values({ orgId, endpoint, modifiedSince: started })
          .onConflictDoUpdate({ target: [syncCursors.orgId, syncCursors.endpoint], set: { modifiedSince: started } });
      }
    });
  }

  const { pending, ...summary } = await withOrg(orgId, (tx) => detect(tx, orgId, opts.asAt, hints));
  const queued = await enqueueAll(pending);
  return { ...summary, queued };
}

/** Match stored supplier aggregates to the catalogue and rewrite detected_apps. */
export async function detect(tx: Db, orgId: string, asAt: string, hints: SupplierHints | null) {
  const since = monthsBack(asAt, 12);
  const recent = new Set(Array.from({ length: 4 }, (_, i) => monthsBack(asAt, i + 1)));
  const rows = await tx.select().from(supplierSpend).where(gte(supplierSpend.month, since));
  // Catalogue YAML plus aliases people confirmed from the review queue.
  const confirmed = await tx.select({ appId: fingerprints.appId, pattern: fingerprints.pattern }).from(fingerprints);
  const fps = dedupeFingerprints([...catalogFingerprints(), ...confirmed]);

  const softwareCodes = new Set(
    (
      await tx
        .select({ code: accounts.code })
        .from(accounts)
        .innerJoin(accountMaps, and(eq(accountMaps.orgId, accounts.orgId), eq(accountMaps.xeroAccountId, accounts.xeroAccountId)))
        .where(eq(accountMaps.category, "software_subscriptions"))
    )
      .map((r) => r.code)
      .filter(Boolean) as string[],
  );

  const byContact = new Map<string, { name: string; norm: string; match: Match | null }>();
  for (const r of rows) {
    if (!byContact.has(r.contactId)) byContact.set(r.contactId, { name: r.contactName, norm: r.nameNorm, match: matchSupplier(r.nameNorm, fps) });
  }

  type Acc = { spend: number; months: Set<string>; last: string; contacts: Map<string, { name: string; match: string; score: number }>; sources: Set<string> };
  const perApp = new Map<string, Acc>();
  const pending: QueueItem[] = [];

  for (const [contactId, c] of byContact) {
    if (c.match?.kind === "fuzzy_check") {
      pending.push({
          kind: "fingerprint_check",
          orgId,
          ref: { org_id: orgId, contact_id: contactId, app_id: c.match.appId },
          reason: `Supplier "${c.name}" looks like ${c.match.appId} (similarity ${c.match.score}). Confirm to add it as an alias.`,
      });
      continue;
    }
    if (!c.match) {
      const codes = hints?.get(contactId)?.accountCodes;
      if (codes && [...codes].some((code) => softwareCodes.has(code))) {
        pending.push({
            kind: "unknown_supplier",
            orgId,
            ref: { org_id: orgId, contact_id: contactId },
            reason: `"${c.name}" is paid from a software account but matches no app in the catalogue.`,
        });
      }
    }
  }

  for (const r of rows) {
    const c = byContact.get(r.contactId)!;
    if (!c.match || c.match.kind === "fuzzy_check") continue;
    const a = perApp.get(c.match.appId) ?? { spend: 0, months: new Set(), last: r.month, contacts: new Map(), sources: new Set() };
    a.spend += r.amount;
    a.months.add(r.month);
    if (r.month > a.last) a.last = r.month;
    a.contacts.set(r.contactId, { name: r.contactName, match: c.match.kind, score: c.match.score });
    a.sources.add(r.source);
    perApp.set(c.match.appId, a);
  }

  await tx.delete(detectedApps).where(eq(detectedApps.orgId, orgId));
  const out = [...perApp].map(([appId, a]) => ({
    orgId,
    appId,
    spend12m: Math.round(a.spend * 100) / 100,
    monthsSeen: a.months.size,
    lastSeen: a.last,
    present: [...a.months].filter((m) => recent.has(m)).length >= 2,
    evidence: { contacts: [...a.contacts.values()], sources: [...a.sources] },
  }));
  if (out.length) await tx.insert(detectedApps).values(out);
  return { suppliers: byContact.size, detected: out.length, present: out.filter((o) => o.present).length, pending };
}
