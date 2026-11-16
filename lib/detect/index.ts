/**
 * Apps in use (BACKEND.md §6). Bills (summaryOnly) + bank spend for the last 12 months → per-supplier
 * monthly aggregates → fingerprint match → detected_apps. Individual transactions are never persisted.
 *
 * Incremental (13 Nov 2026): aggregates can't be patched with deltas (the original rows are gone), but months
 * before the earliest change are still right. So: ask Xero for what changed since the last run (If-Modified-Since,
 * voided bills included), rebuild from the earliest month those records touch, keep older months as stored.
 * A full 13-month rebuild runs on the first refresh and whenever the last one is older than FULL_REBUILD_DAYS,
 * to catch the one edit a delta can't show (a record moved out of an older month).
 * First live ledger: a full pull was 118 calls / 19 MB; a daily refresh now rebuilds about one month.
 */
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { accountMaps, accounts, appStatusAnswers, detectedApps, fingerprints, orgs, supplierSpend, syncCursors, appStateHistory } from "@/db/schema";
import { withOrg, type Db } from "@/lib/db/client";
import { rulesFile } from "@/lib/catalog/load";
import { apps as catalogApps } from "@/lib/catalog/load";
import { enqueueAll, type QueueItem } from "@/lib/queue/enqueue";
import type { XeroClient } from "@/lib/xero/client";
import { CHANGED_BILL_STATUSES, bills, spendTransactions } from "@/lib/xero/endpoints";
import { monthsBack } from "@/lib/sync/periods";
import { SpendAggregator, monthOf, type SupplierHints } from "./aggregate";
import { matchSupplier, type Fingerprint, type Match } from "./match";
import { COUNTS_AS_COVERAGE, lapsingNeedsReview, lifecycleOf, type StatusAnswer } from "./lifecycle";

/** v1.1 C: 13 months of supplier spend, so annual billing shows two payments. */
export const LOOKBACK_MONTHS = 13;

export function catalogFingerprints(): Fingerprint[] {
  return catalogApps().flatMap((a) => a.fingerprints.map((pattern) => ({ appId: a.id, pattern })));
}

export function dedupeFingerprints(fps: Fingerprint[]): Fingerprint[] {
  const seen = new Set<string>();
  return fps.filter((f) => (seen.has(f.pattern) ? false : (seen.add(f.pattern), true)));
}

/** A full rebuild at least this often (see the header). */
export const FULL_REBUILD_DAYS = 7;
/** Asked a little before the stored cursor, so a clock difference with Xero can't hide a change. */
const CURSOR_MARGIN_MS = 10 * 60_000;

/** The earliest transaction date among records changed since `cursor`, or null when nothing changed. */
async function earliestChange(c: XeroClient, since: Date, cursor: Date): Promise<Date | null> {
  const probe = new Date(cursor.getTime() - CURSOR_MARGIN_MS);
  let min: Date | null = null;
  const see = (d: Date) => {
    if (!min || d < min) min = d;
  };
  for await (const page of bills(c, since, probe, CHANGED_BILL_STATUSES)) for (const b of page) see(b.Date);
  for await (const page of spendTransactions(c, since, probe)) for (const t of page) see(t.Date);
  return min;
}

/** Which months to rebuild: all of them, from a month on, or none. Exported for tests. */
export async function rebuildFrom(c: XeroClient, since: string, cursor: Date | null, now: Date): Promise<string | null> {
  if (!cursor || now.getTime() - cursor.getTime() > FULL_REBUILD_DAYS * 86_400_000) return since;
  const min = await earliestChange(c, new Date(since + "T00:00:00Z"), cursor);
  if (!min) return null;
  const m = monthOf(min);
  return m > since ? m : since;
}

export async function syncAppsInUse(orgId: string, client: XeroClient, opts: { asAt: string; now?: Date }) {
  const started = opts.now ?? new Date();
  // v1.1 C: 13 months, so an annual app shows two payments.
  const since = monthsBack(opts.asAt, LOOKBACK_MONTHS);

  const cursor = await withOrg(orgId, async (tx) => {
    const rows = await tx.select().from(syncCursors).where(eq(syncCursors.orgId, orgId));
    const inv = rows.find((r) => r.endpoint === "invoices")?.modifiedSince ?? null;
    const bank = rows.find((r) => r.endpoint === "banktransactions")?.modifiedSince ?? null;
    return inv && bank ? (inv < bank ? inv : bank) : null;
  });

  let hints: SupplierHints | null = null;
  const from = await rebuildFrom(client, since, cursor, started);
  if (from) {
    const fromDate = new Date(from + "T00:00:00Z");
    const agg = new SpendAggregator();
    for await (const page of bills(client, fromDate)) agg.addBills(page);
    for await (const page of spendTransactions(client, fromDate)) agg.addSpend(page);
    const rows = agg.result();
    // Partial rebuild: hints only cover the rebuilt months, which is enough to raise new unknown suppliers.
    hints = agg.hints;
    await withOrg(orgId, async (tx) => {
      await tx.delete(supplierSpend).where(and(eq(supplierSpend.orgId, orgId), gte(supplierSpend.month, from)));
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

  const today = started.toISOString().slice(0, 10);
  const { pending, ...summary } = await withOrg(orgId, (tx) => detect(tx, orgId, opts.asAt, hints, today));
  const queued = await enqueueAll(pending);
  return { ...summary, queued };
}

/**
 * NEXT-STEPS P2.14, pure: lifecycle changes between two runs. An app that appears has fromState null; one that
 * disappears has state null. Unchanged apps produce nothing.
 */
export function stateChanges(before: Map<string, string | null>, after: Map<string, string | null>) {
  const out: { appId: string; fromState: string | null; state: string | null }[] = [];
  for (const [appId, state] of after) if (!before.has(appId) || before.get(appId) !== state) out.push({ appId, fromState: before.get(appId) ?? null, state });
  for (const [appId, fromState] of before) if (!after.has(appId)) out.push({ appId, fromState, state: null });
  return out.sort((a, b) => a.appId.localeCompare(b.appId));
}

/** Match stored supplier aggregates to the catalogue and rewrite detected_apps. */
export async function detect(tx: Db, orgId: string, asAt: string, hints: SupplierHints | null, today = new Date().toISOString().slice(0, 10)) {
  const since = monthsBack(asAt, LOOKBACK_MONTHS);
  const rows = await tx.select().from(supplierSpend).where(gte(supplierSpend.month, since));
  // Round-2 3a: how far the books are entered = the latest bill or spend date of any supplier.
  const booksThrough = rows.reduce<string | null>((m, r) => (r.lastDate && (!m || r.lastDate > m) ? r.lastDate : m), null);
  await tx.update(orgs).set({ booksThrough }).where(eq(orgs.id, orgId));
  const leewayDays = rulesFile().lifecycle.leeway_days;
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

  type Acc = { spend: number; months: Set<string>; byMonth: Map<string, number>; last: string; lastPaid: string | null; contacts: Map<string, { name: string; match: string; score: number }>; sources: Set<string> };
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
    const a = perApp.get(c.match.appId) ?? { spend: 0, months: new Set(), byMonth: new Map(), last: r.month, lastPaid: null, contacts: new Map(), sources: new Set() };
    if (r.lastDate && (!a.lastPaid || r.lastDate > a.lastPaid)) a.lastPaid = r.lastDate;
    a.spend += r.amount;
    a.months.add(r.month);
    a.byMonth.set(r.month, (a.byMonth.get(r.month) ?? 0) + r.amount);
    if (r.month > a.last) a.last = r.month;
    a.contacts.set(r.contactId, { name: r.contactName, match: c.match.kind, score: c.match.score });
    a.sources.add(r.source);
    perApp.set(c.match.appId, a);
  }

  // v1.1 C: each app's latest answer (still use / moved / stopped / replacing), newest first.
  const answers = await tx.select().from(appStatusAnswers).orderBy(desc(appStatusAnswers.createdAt));
  const latestAnswer = new Map<string, StatusAnswer>();
  for (const r of answers) if (!latestAnswer.has(r.appId)) latestAnswer.set(r.appId, { answer: r.answer, at: r.createdAt.toISOString().slice(0, 10), replacedBy: r.replacedByAppId });

  // NEXT-STEPS P2.14: remember each app's state before the rewrite, to record what changed.
  const before = new Map((await tx.select({ appId: detectedApps.appId, state: detectedApps.state }).from(detectedApps).where(eq(detectedApps.orgId, orgId))).map((r) => [r.appId, r.state]));
  await tx.delete(detectedApps).where(eq(detectedApps.orgId, orgId));
  const yearAgo = monthsBack(asAt, 12);
  const out = [...perApp].map(([appId, a]) => {
    const life = lifecycleOf([...a.months], asAt, latestAnswer.get(appId), { lastPaid: a.lastPaid, booksThrough, today, leewayDays });
    if (lapsingNeedsReview(life, asAt) && !latestAnswer.has(appId)) {
      pending.push({
        kind: "app_lapsing",
        orgId,
        ref: { org_id: orgId, app_id: appId, last_paid: a.last },
        reason: `No payment to ${catalogApps().find((x) => x.id === appId)?.name ?? appId} since ${a.last.slice(0, 7)} and the business hasn't answered "Do you still use it?" for 30 days. Look at the pattern; we don't contact customers outside the app.`,
      });
    }
    const row: typeof detectedApps.$inferInsert & { evidence: Record<string, unknown> } = {
    orgId,
    appId,
    // spend_12m stays a 12-month figure even though we look back 13 months for annual billing.
    spend12m: Math.round([...a.byMonth].filter(([m]) => m >= yearAgo).reduce((t, [, v]) => t + v, 0) * 100) / 100,
    monthsSeen: a.months.size,
    lastSeen: a.last,
    present: COUNTS_AS_COVERAGE.has(life.state),
    cycle: life.cycle,
    state: life.state,
    nextExpected: life.nextExpected,
    lastPaidDate: a.lastPaid,
    // Monthly totals (aggregates only) feed the after-install chart, renewal checks and peer prices.
    evidence: {
      contacts: [...a.contacts.values()],
      sources: [...a.sources],
      monthly: Object.fromEntries([...a.byMonth].sort(([x], [y]) => x.localeCompare(y)).map(([m, v]) => [m, Math.round(v * 100) / 100])),
      ...(life.ask ? { ask: "still_use" } : {}),
    },
  };
    return row;
  });
  // Apps the user told us they use but we can't see paying (personal card, parent company, free plan).
  for (const [appId, ans] of latestAnswer) {
    if (perApp.has(appId) || ans.answer !== "declared" || !catalogApps().some((x) => x.id === appId)) continue;
    const life = lifecycleOf([], asAt, ans);
    if (life.state !== "declared") continue;
    out.push({ orgId, appId, spend12m: 0, monthsSeen: 0, lastSeen: ans.at, present: true, cycle: life.cycle, state: life.state, nextExpected: null, evidence: { contacts: [], sources: [], monthly: {}, declared: true } });
  }
  // A new app in the same job as one still in use: ask "Is X replacing Y?" (once).
  const job = (id: string) => (catalogApps().find((x) => x.id === id)?.categories ?? []).filter((c) => c !== "accounting" && c !== "other_software");
  for (const n of out.filter((o) => o.state === "new" && !latestAnswer.has(o.appId))) {
    const old = out.find((o) => o.appId !== n.appId && (o.state === "active" || o.state === "lapsing") && job(o.appId).some((c) => job(n.appId).includes(c)));
    if (old) (n.evidence as Record<string, unknown>).ask = { replacing: old.appId };
  }
  if (out.length) await tx.insert(detectedApps).values(out);
  const changes = stateChanges(before, new Map(out.map((o) => [o.appId, o.state ?? null])));
  if (changes.length) await tx.insert(appStateHistory).values(changes.map((c) => ({ orgId, ...c })));
  return { suppliers: byContact.size, detected: out.length, present: out.filter((o) => o.present).length, pending };
}
