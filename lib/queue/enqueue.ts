/** The review queue: the single inbox for people (BACKEND.md §9). Items dedupe on (kind, ref_hash). */
import { createHash } from "node:crypto";
import { reviewQueue } from "@/db/schema";
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
  | "flag_disputed";

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
 * run: e.g. {org_id, xero_account_id} for a mapping. Returns true if a new item was created.
 */
export async function enqueue(
  item: { kind: QueueKind; orgId: string | null; ref: Record<string, unknown>; reason: string },
  db?: Db,
): Promise<boolean> {
  db ??= await adminDb();
  const rows = await db
    .insert(reviewQueue)
    .values({ kind: item.kind, orgId: item.orgId, ref: item.ref, refHash: refHash(item.ref), reason: item.reason })
    .onConflictDoNothing({ target: [reviewQueue.kind, reviewQueue.refHash] })
    .returning({ id: reviewQueue.id });
  return rows.length > 0;
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
