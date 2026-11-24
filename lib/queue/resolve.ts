/**
 * Resolving review-queue items (BACKEND.md §9). Every resolution writes an audit_log row; resolutions that
 * change what the system believes (a mapping, an alias, an accepted cash flow) recompute the org from
 * stored rows — no Xero calls.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { accountMaps, appFacts, apps as appsT, auditLog, cashflowAcceptances, fingerprints, reviewQueue, statements, supplierSpend } from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { HttpError } from "@/lib/api";
import { accountCategories, apps as catalogApps } from "@/lib/catalog/load";
import { FACT_FIELDS } from "@/lib/catalog/facts";
import { detect } from "@/lib/detect";
import { recompute } from "@/lib/sync/refresh";
import { enqueueAll, type QueueKind } from "./enqueue";
import { moderate } from "@/lib/reviews";
import { markSent } from "@/lib/quotes";

export const Resolution = z.discriminatedUnion("action", [
  z.object({ action: z.literal("map"), category: z.string() }),
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("add_alias"), app_id: z.string() }),
  z.object({ action: z.literal("accept"), note: z.string().trim().min(3) }),
  z.object({ action: z.literal("note"), note: z.string().trim().min(3) }),
  // fact_*: a person enters the value and where they saw it → state "verified".
  z.object({ action: z.literal("verify"), field: z.string(), value: z.unknown(), source_url: z.string().url() }),
  z.object({ action: z.literal("dismiss"), note: z.string().trim().optional() }),
  // review_moderation: publish, or reject with the rule it breaks (never for being negative).
  z.object({ action: z.literal("publish") }),
  z.object({ action: z.literal("reject"), note: z.string().trim().min(3) }),
  // quote_request: our team sent it to the vendors (replies are entered separately).
  z.object({ action: z.literal("mark_sent") }),
]);
export type Resolution = z.infer<typeof Resolution>;

/** Which actions make sense for each kind. */
export const ALLOWED: Record<QueueKind, Resolution["action"][]> = {
  account_mapping: ["map", "dismiss"],
  user_report: ["note", "dismiss"],
  fingerprint_check: ["confirm", "note", "dismiss"],
  unknown_supplier: ["add_alias", "dismiss"],
  cashflow_unreconciled: ["accept", "dismiss"],
  flag_disputed: ["note", "dismiss"],
  fact_missing: ["verify", "note", "dismiss"],
  fact_conflicting: ["verify", "note", "dismiss"],
  fact_stale: ["verify", "note", "dismiss"],
  fact_spot_check: ["verify", "note", "dismiss"],
  review_moderation: ["publish", "reject"],
  quote_request: ["mark_sent", "dismiss"],
  app_lapsing: ["note", "dismiss"],
  // ENGINE-V2: a person adds the app to the crosswalk / catalogue in a PR, then notes it here.
  appdb_match: ["note", "dismiss"],
  catalog_gap: ["note", "dismiss"],
};

export async function listQueue(opts: { kind?: string; status?: "open" | "done" | "dismissed"; limit?: number } = {}) {
  const db = await adminDb();
  const where = and(eq(reviewQueue.status, opts.status ?? "open"), opts.kind ? eq(reviewQueue.kind, opts.kind) : undefined);
  return db
    .select()
    .from(reviewQueue)
    .where(where)
    // High priority first (round-2 3b), then oldest first.
    .orderBy(asc(reviewQueue.priority), asc(reviewQueue.createdAt))
    .limit(opts.limit ?? 200);
}

const str = (v: unknown, what: string) => {
  if (typeof v !== "string" || !v) throw new HttpError(422, `Queue item is missing ${what}`);
  return v;
};

async function ensureAppRow(appId: string) {
  const a = catalogApps().find((x) => x.id === appId);
  if (!a) throw new HttpError(422, `Unknown app ${appId}`);
  const db = await adminDb();
  await db
    .insert(appsT)
    .values({ id: a.id, name: a.name, website: a.website ?? null, categories: a.categories, markets: a.markets, crawl: a.crawl ?? null, sample: a.sample })
    .onConflictDoNothing();
}

async function addAlias(orgId: string, contactId: string, appId: string) {
  const [row] = await withOrg(orgId, (tx) =>
    tx.select({ nameNorm: supplierSpend.nameNorm }).from(supplierSpend).where(eq(supplierSpend.contactId, contactId)).limit(1),
  );
  if (!row?.nameNorm) throw new HttpError(422, "That supplier has no spend on record any more");
  await ensureAppRow(appId);
  const db = await adminDb();
  await db.insert(fingerprints).values({ appId, pattern: row.nameNorm, kind: "alias" }).onConflictDoNothing();
  return row.nameNorm;
}

/** Re-run detection from stored supplier aggregates (no Xero calls). */
export async function redetect(orgId: string) {
  const asAt = await withOrg(orgId, async (tx) => {
    const [pl] = await tx.select({ periodTo: statements.periodTo }).from(statements).where(eq(statements.kind, "pl")).orderBy(desc(statements.createdAt)).limit(1);
    return pl?.periodTo ?? null;
  });
  if (!asAt) return;
  const { pending } = await withOrg(orgId, (tx) => detect(tx, orgId, asAt, null));
  await enqueueAll(pending);
}

export async function resolveItem(id: string, actor: string, resolution: Resolution) {
  const db = await adminDb();
  const [item] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id));
  if (!item) throw new HttpError(404, "Queue item not found");
  if (item.status !== "open") throw new HttpError(409, `Already ${item.status}`);
  const kind = item.kind as QueueKind;
  if (!ALLOWED[kind]?.includes(resolution.action)) {
    throw new HttpError(400, `"${resolution.action}" doesn't resolve a ${kind} item; use one of: ${(ALLOWED[kind] ?? []).join(", ")}`);
  }
  const ref = item.ref as Record<string, unknown>;
  const orgId = item.orgId;
  const effects: string[] = [];
  let recomputeOrg = false;
  let detectOrg = false;

  switch (resolution.action) {
    case "map": {
      if (!orgId) throw new HttpError(422, "Mapping item has no org");
      const category = resolution.category;
      if (!accountCategories().some((c) => c.key === category)) throw new HttpError(422, `Unknown account category ${category}`);
      const xeroAccountId = str(ref.xero_account_id, "xero_account_id");
      await withOrg(orgId, async (tx) => {
        const row = { orgId, xeroAccountId, category, confidence: 1, source: "confirmed" as const, ruleId: null, updatedAt: new Date() };
        await tx.insert(accountMaps).values(row).onConflictDoUpdate({ target: [accountMaps.orgId, accountMaps.xeroAccountId], set: row });
      });
      effects.push(`mapped ${xeroAccountId} → ${category}`);
      recomputeOrg = true;
      break;
    }
    case "confirm":
    case "add_alias": {
      if (!orgId) throw new HttpError(422, "Supplier item has no org");
      const appId = resolution.action === "confirm" ? str(ref.app_id, "app_id") : resolution.app_id;
      const pattern = await addAlias(orgId, str(ref.contact_id, "contact_id"), appId);
      effects.push(`alias "${pattern}" → ${appId}`);
      detectOrg = recomputeOrg = true;
      break;
    }
    case "accept": {
      if (!orgId) throw new HttpError(422, "Cash flow item has no org");
      const periodTo = str(ref.period_to, "period_to");
      const [cf] = await withOrg(orgId, (tx) =>
        tx.select().from(statements).where(and(eq(statements.kind, "cf"), eq(statements.periodTo, periodTo))).orderBy(desc(statements.createdAt)).limit(1),
      );
      if (!cf) throw new HttpError(422, "No cash flow statement for that period");
      // Owner connection: the app role only reads acceptances.
      const row = { orgId, periodTo, diff: cf.reconDiff ?? 0, note: resolution.note, acceptedBy: actor, acceptedAt: new Date() };
      await db.insert(cashflowAcceptances).values(row).onConflictDoUpdate({ target: [cashflowAcceptances.orgId, cashflowAcceptances.periodTo], set: row });
      effects.push(`accepted £${Math.abs(row.diff).toFixed(2)} unexplained for ${periodTo}`);
      recomputeOrg = true;
      break;
    }
    case "verify": {
      const appId = str(ref.app_id, "app_id");
      if (!(FACT_FIELDS as readonly string[]).includes(resolution.field)) throw new HttpError(422, `Unknown fact field ${resolution.field}`);
      if (resolution.value === undefined || resolution.value === null) throw new HttpError(422, "A verified fact needs a value");
      await ensureAppRow(appId);
      const row = { appId, field: resolution.field, value: resolution.value, state: "verified" as const, quote: null, sourceUrl: resolution.source_url, checkedAt: new Date(), checkedBy: actor, sample: false };
      await db.insert(appFacts).values(row).onConflictDoUpdate({ target: [appFacts.appId, appFacts.field], set: row });
      effects.push(`verified ${appId}.${resolution.field} = ${JSON.stringify(resolution.value)}`);
      break;
    }
    case "publish":
    case "reject": {
      const reviewId = str(ref.review_id, "review_id");
      await moderate(reviewId, resolution.action);
      effects.push(`${resolution.action === "publish" ? "published" : "rejected"} review ${reviewId}`);
      break;
    }
    case "mark_sent": {
      const requestId = str(ref.request_id, "request_id");
      await markSent(requestId, actor);
      effects.push(`quote request ${requestId} sent`);
      break;
    }
    case "note":
    case "dismiss":
      break;
  }

  const status = resolution.action === "dismiss" ? "dismissed" : "done";
  const [updated] = await db
    .update(reviewQueue)
    .set({ status, resolution: { ...resolution, effects, by: actor }, assignee: actor, resolvedAt: new Date() })
    .where(and(eq(reviewQueue.id, id), eq(reviewQueue.status, "open")))
    .returning();
  if (!updated) throw new HttpError(409, "Resolved by someone else just now");
  await db.insert(auditLog).values({ actor, action: `queue.${status}.${kind}`, target: { id, kind, ref, resolution, effects } });

  if (orgId && detectOrg) await redetect(orgId);
  if (orgId && recomputeOrg) await recompute(orgId);
  return { item: updated, effects, recomputed: Boolean(orgId && recomputeOrg) };
}
