/**
 * Quote requests (CLAUDE.md §7.3b, "Where prices come from" #3).
 *
 * One click asks up to three vendors for a price. What goes to vendors is the situation only: industry, size band,
 * markets, sites, headcount, the apps they'll keep and their must-haves. Never ledger amounts or transactions.
 * The user sees exactly what will be sent before sending (Xero terms 7(b)(ii): their consent to pass it on).
 * A person on our team sends it (review queue "quote_request") and enters replies in the same structure;
 * response time per vendor is tracked and shown.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { auditLog, quoteReplies, quoteRequests, type QuoteSituation } from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { HttpError } from "@/lib/api";
import { apps as catalogApps } from "@/lib/catalog/load";
import { enqueue } from "@/lib/queue/enqueue";
import { features } from "@/lib/llm/ask";

const OFF = new Set(["accounting", "other_software"]);
const appName = (id: string) => catalogApps().find((a) => a.id === id)?.name ?? id;
export const MIN_FOR_RESPONSE_TIME = 3;

export const QuoteInput = z.object({
  appIds: z.array(z.string().min(1).max(64)).min(1).max(3),
  lineKey: z.string().max(200).nullish(),
  sites: z.number().int().min(1).max(10_000).nullish(),
  headcount: z.number().int().min(1).max(1_000_000).nullish(),
  mustHaves: z.string().trim().max(500).nullish(),
  replyTo: z.string().trim().email(),
});

export const ReplyInput = z.object({
  appId: z.string().min(1).max(64),
  priceMonthly: z.number().min(0).nullish(),
  priceText: z.string().trim().min(2).max(500),
  terms: z.record(z.string(), z.string().max(300)).optional(),
  receivedAt: z.string().datetime().optional(),
});

/** What would be sent to vendors, for the user to see first. Built from derived features only. */
export async function situationFor(orgId: string, extra: { sites?: number | null; headcount?: number | null; mustHaves?: string | null }): Promise<QuoteSituation> {
  const f = await features(orgId);
  return {
    industry: f.industry,
    sizeBand: f.sizeBand,
    markets: f.markets,
    sites: extra.sites ?? null,
    headcount: extra.headcount ?? null,
    keeps: f.inUse.filter((id) => !catalogApps().find((a) => a.id === id)?.categories.every((c) => OFF.has(c))).map(appName),
    mustHaves: extra.mustHaves ?? null,
  };
}

export async function requestQuotes(orgId: string, userId: string | null, input: z.infer<typeof QuoteInput>) {
  const ids = [...new Set(input.appIds)];
  for (const id of ids) if (!catalogApps().some((a) => a.id === id)) throw new HttpError(404, `Unknown app ${id}`);
  const situation = await situationFor(orgId, input);
  const [row] = await withOrg(orgId, (tx) =>
    tx.insert(quoteRequests).values({ orgId, lineKey: input.lineKey ?? null, appIds: ids, situation, replyTo: input.replyTo, createdBy: userId }).returning(),
  );
  const db = await adminDb();
  await db.insert(auditLog).values({ actor: userId ?? "user", action: "quote.requested", target: { request_id: row!.id, org_id: orgId, apps: ids } });
  await enqueue({
    kind: "quote_request",
    orgId,
    ref: { request_id: row!.id },
    reason: `Send a quote request to ${ids.map(appName).join(", ")}. Situation only (no figures); vendors reply to the address on the request. Enter each reply when it arrives.`,
  });
  return row!;
}

/** Our team marks the request as sent to the vendors (starts the response clock). */
export async function markSent(requestId: string, actor: string) {
  const db = await adminDb();
  const [row] = await db.update(quoteRequests).set({ sentAt: new Date() }).where(eq(quoteRequests.id, requestId)).returning();
  if (!row) throw new HttpError(404, "Quote request not found");
  await db.insert(auditLog).values({ actor, action: "quote.sent", target: { request_id: requestId } });
  return row;
}

/** Our team enters a vendor's reply, in the same structure for every vendor. */
export async function addReply(requestId: string, input: z.infer<typeof ReplyInput>, actor: string) {
  const db = await adminDb();
  const [req] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, requestId));
  if (!req) throw new HttpError(404, "Quote request not found");
  if (!req.appIds.includes(input.appId)) throw new HttpError(422, "That vendor wasn't asked in this request");
  if (!req.sentAt) throw new HttpError(409, "Mark the request as sent first");
  const row = {
    requestId,
    orgId: req.orgId,
    appId: input.appId,
    priceMonthly: input.priceMonthly ?? null,
    priceText: input.priceText,
    terms: input.terms ?? {},
    receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    enteredBy: actor,
  };
  await db.insert(quoteReplies).values(row).onConflictDoUpdate({ target: [quoteReplies.requestId, quoteReplies.appId], set: row });
  await db.insert(auditLog).values({ actor, action: "quote.reply_entered", target: { request_id: requestId, app_id: input.appId } });
  return row;
}

/** This business's requests and the replies so far. */
export async function orgQuotes(orgId: string, lineKey?: string) {
  return withOrg(orgId, async (tx) => {
    const reqs = await tx
      .select()
      .from(quoteRequests)
      .where(lineKey ? eq(quoteRequests.lineKey, lineKey) : undefined)
      .orderBy(desc(quoteRequests.createdAt));
    if (!reqs.length) return [];
    const reps = await tx.select().from(quoteReplies).where(inArray(quoteReplies.requestId, reqs.map((r) => r.id)));
    return reqs.map((r) => ({
      ...r,
      vendors: r.appIds.map((id) => ({ appId: id, name: appName(id), reply: reps.find((x) => x.requestId === r.id && x.appId === id) ?? null })),
    }));
  });
}

/** Median days from "sent" to reply per vendor, from MIN_FOR_RESPONSE_TIME+ replies. Pure statistics. */
export function medianDays(pairs: { sentAt: Date; receivedAt: Date }[]): number | null {
  if (pairs.length < MIN_FOR_RESPONSE_TIME) return null;
  const d = pairs.map((p) => (p.receivedAt.getTime() - p.sentAt.getTime()) / 86_400_000).sort((a, b) => a - b);
  const m = d.length % 2 ? d[(d.length - 1) / 2]! : (d[d.length / 2 - 1]! + d[d.length / 2]!) / 2;
  return Math.round(m * 10) / 10;
}

export async function responseTime(appId: string) {
  const db = await adminDb();
  const rows = await db
    .select({ sentAt: quoteRequests.sentAt, receivedAt: quoteReplies.receivedAt })
    .from(quoteReplies)
    .innerJoin(quoteRequests, eq(quoteRequests.id, quoteReplies.requestId))
    .where(and(eq(quoteReplies.appId, appId), isNotNull(quoteRequests.sentAt)));
  const pairs = rows.map((r) => ({ sentAt: r.sentAt!, receivedAt: r.receivedAt }));
  return { days: medianDays(pairs), n: pairs.length };
}
