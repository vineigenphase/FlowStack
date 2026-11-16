/**
 * What the admin queue page shows (BACKEND.md §9). Open items, oldest first, with what a person needs to decide:
 * the org name, and for reviews and quote requests the thing being checked. No raw ledger lines.
 */
import { inArray } from "drizzle-orm";
import { orgs, quoteRequests, reviews } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { apps as catalogApps } from "@/lib/catalog/load";
import { ALLOWED, listQueue } from "./resolve";
import type { QueueKind } from "./enqueue";

export const KIND_LABELS: Record<QueueKind, string> = {
  review_moderation: "Reviews to check",
  quote_request: "Quote requests to send",
  account_mapping: "Accounts to map",
  user_report: "Problem reports",
  unknown_supplier: "Suppliers we don't recognise",
  fingerprint_check: "App matches to confirm",
  cashflow_unreconciled: "Cash flows that don't reconcile",
  flag_disputed: "Flags a business disputed",
  fact_conflicting: "App facts: sources disagree",
  fact_missing: "App facts: not published",
  fact_stale: "App facts: out of date",
  fact_spot_check: "App facts: spot checks",
  app_lapsing: "Apps whose payments stopped (no answer)",
};
/** Order on the page: things a customer is waiting on first. */
const ORDER = Object.keys(KIND_LABELS) as QueueKind[];

export type QueueRow = {
  id: string;
  kind: QueueKind;
  reason: string;
  createdAt: Date;
  orgName: string | null;
  ref: Record<string, unknown>;
  actions: string[];
  review?: { appName: string; role: string; scores: Record<string, number>; body: string; verifiedMonths: number; sample: boolean };
  quote?: { appNames: string[]; situation: Record<string, unknown>; replyTo: string };
};

const appName = (id: unknown) => catalogApps().find((a) => a.id === id)?.name ?? String(id);

export async function queueView(): Promise<{ kind: QueueKind; label: string; items: QueueRow[] }[]> {
  const items = await listQueue({ status: "open", limit: 500 });
  const db = await adminDb();
  const ids = <K extends string>(kind: string, key: K) =>
    items.filter((i) => i.kind === kind).map((i) => (i.ref as Record<K, unknown>)[key]).filter((v): v is string => typeof v === "string");
  const orgIds = [...new Set(items.map((i) => i.orgId).filter((v): v is string => !!v))];
  const reviewIds = ids("review_moderation", "review_id");
  const quoteIds = ids("quote_request", "request_id");
  const [orgRows, reviewRows, quoteRows] = await Promise.all([
    orgIds.length ? db.select({ id: orgs.id, name: orgs.name }).from(orgs).where(inArray(orgs.id, orgIds)) : [],
    reviewIds.length ? db.select().from(reviews).where(inArray(reviews.id, reviewIds)) : [],
    quoteIds.length ? db.select().from(quoteRequests).where(inArray(quoteRequests.id, quoteIds)) : [],
  ]);
  const orgName = new Map(orgRows.map((o) => [o.id, o.name]));
  const review = new Map(reviewRows.map((r) => [r.id, r]));
  const quote = new Map(quoteRows.map((q) => [q.id, q]));

  const rows: QueueRow[] = items.map((i) => {
    const ref = i.ref as Record<string, unknown>;
    const kind = i.kind as QueueKind;
    const r = kind === "review_moderation" ? review.get(String(ref.review_id)) : undefined;
    const q = kind === "quote_request" ? quote.get(String(ref.request_id)) : undefined;
    return {
      id: i.id,
      kind,
      reason: i.reason,
      createdAt: i.createdAt,
      orgName: i.orgId ? (orgName.get(i.orgId) ?? null) : null,
      ref,
      actions: ALLOWED[kind] ?? [],
      review: r
        ? { appName: appName(r.appId), role: r.role, scores: r.scores as Record<string, number>, body: r.body, verifiedMonths: r.verifiedMonths, sample: r.sample }
        : undefined,
      quote: q ? { appNames: q.appIds.map(appName), situation: q.situation as Record<string, unknown>, replyTo: q.replyTo } : undefined,
    };
  });
  return ORDER.map((kind) => ({ kind, label: KIND_LABELS[kind], items: rows.filter((r) => r.kind === kind) })).filter((g) => g.items.length);
}
