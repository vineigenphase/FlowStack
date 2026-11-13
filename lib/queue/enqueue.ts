/** The review queue: the single inbox for people (BACKEND.md §9). Items dedupe on (kind, ref_hash). */
import { createHash } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { auditLog, reviewQueue } from "@/db/schema";
import { adminDb, type Db } from "@/lib/db/client";

export type QueueKind =
  | "account_mapping"
  | "fingerprint_check"
  | "unknown_supplier"
  | "fact_missing"
  | "fact_conflicting"
  | "fact_stale"
  | "fact_spot_check"
  | "cashflow_unreconciled"
  | "flag_disputed"
  | "review_moderation"
  | "quote_request"
  | "app_lapsing";

/** Stable JSON: keys sorted, so the same ref always hashes the same. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export const refHash = (ref: unknown) => createHash("sha256").update(stableJson(ref)).digest("hex").slice(0, 32);

/**
 * Open an item unless the same (kind, ref) already exists. `ref` must identify the problem, not the
 * run: e.g. {org_id, xero_account_id} for a mapping. Returns true if an item was created or reopened.
 *
 * An item the system closed itself (resolution.auto, see autoClose) reopens when the problem comes back.
 * Items a person resolved or dismissed stay closed.
 */
export async function enqueue(
  item: { kind: QueueKind; orgId: string | null; ref: Record<string, unknown>; reason: string },
  db?: Db,
): Promise<boolean> {
  db ??= await adminDb();
  const rows = await db
    .insert(reviewQueue)
    .values({ kind: item.kind, orgId: item.orgId, ref: item.ref, refHash: refHash(item.ref), reason: item.reason })
    .onConflictDoUpdate({
      target: [reviewQueue.kind, reviewQueue.refHash],
      set: { status: "open", reason: item.reason, resolution: null, assignee: null, resolvedAt: null },
      setWhere: sql`${reviewQueue.status} = 'done' and ${reviewQueue.resolution}->>'auto' = 'true'`,
    })
    .returning({ id: reviewQueue.id, inserted: sql<boolean>`xmax = 0` });
  const r = rows[0];
  if (r && !r.inserted) {
    await db.insert(auditLog).values({ actor: "system", action: `queue.reopened.${item.kind}`, target: { id: r.id, kind: item.kind, ref: item.ref, reason: item.reason } });
  }
  return rows.length > 0;
}

/**
 * The system closes an open item because the problem went away (e.g. a later refresh reconciles the cash flow).
 * Marked resolution.auto so enqueue() reopens it if the problem returns. Writes an audit_log row per item.
 * Owner connection, so call it after the tenant transaction commits (like enqueueAll).
 */
export async function autoClose(kind: QueueKind, ref: Record<string, unknown>, note: string, opts: { reasonPrefix?: string } = {}): Promise<number> {
  const db = await adminDb();
  const resolution = { auto: true, by: "system", note };
  const closed = await db
    .update(reviewQueue)
    .set({ status: "done", resolution, assignee: "system", resolvedAt: new Date() })
    .where(
      and(
        eq(reviewQueue.kind, kind),
        eq(reviewQueue.refHash, refHash(ref)),
        eq(reviewQueue.status, "open"),
        // Only close items the system raised itself, never one a person raised about the same thing.
        opts.reasonPrefix ? like(reviewQueue.reason, `${opts.reasonPrefix.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
      ),
    )
    .returning({ id: reviewQueue.id });
  for (const c of closed) {
    await db.insert(auditLog).values({ actor: "system", action: `queue.done.${kind}`, target: { id: c.id, kind, ref, resolution } });
  }
  return closed.length;
}

export type QueueItem = { kind: QueueKind; orgId: string | null; ref: Record<string, unknown>; reason: string };

/**
 * Write items collected inside a withOrg() transaction, after it commits. The queue lives on the owner
 * connection (the app role can't see it), so it must never be written from inside a tenant transaction.
 */
export async function enqueueAll(items: QueueItem[]): Promise<number> {
  let n = 0;
  for (const i of items) if (await enqueue(i)) n++;
  return n;
}
