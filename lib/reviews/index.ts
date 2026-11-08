/**
 * Verified reviews (CLAUDE.md §7.5, §2.6 UK DMCC Act 2024).
 *
 * - Proof of use: the app's bills appear in the reviewer's own ledger for 2+ months (detected_apps.months_seen).
 *   The badge shows that tenure.
 * - A person checks every review before it is public (review_queue "review_moderation"). Rejection is only for
 *   breaking the rules (not about the product, personal data, abuse), never for being negative.
 * - We never write or seed reviews. Sample organisations' reviews are never public.
 * - Incentivised reviews would carry a visible label. No incentive scheme runs yet, so none are incentivised.
 * - Fixed order (newest first). Vendors can reply publicly but can't edit, hide or reorder anything.
 * - Every submit, edit, withdraw, publish and reject writes an audit_log row.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auditLog, detectedApps, orgs, reviewFollowups, reviews, vendorReplies, type ReviewScores } from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { HttpError } from "@/lib/api";
import { apps as catalogApps } from "@/lib/catalog/load";
import { enqueue } from "@/lib/queue/enqueue";

export const MIN_MONTHS = 2;
export const FOLLOWUP_DAY = 90;
/** Reviews needed before they move an app's ranking (peer_results). Under this, peer_results stays neutral. */
export const MIN_FOR_RANKING = 5;

export const ROLES = [
  { key: "finance_director", label: "Finance director or CFO" },
  { key: "finance_manager", label: "Finance manager" },
  { key: "bookkeeper", label: "Bookkeeper" },
  { key: "accountant", label: "Accountant or adviser" },
  { key: "owner", label: "Owner or managing director" },
  { key: "other", label: "Other" },
] as const;

export const PRICE_BANDS = [
  { key: "under_50", label: "Under £50 a month" },
  { key: "50_200", label: "£50–£200 a month" },
  { key: "200_500", label: "£200–£500 a month" },
  { key: "500_1000", label: "£500–£1,000 a month" },
  { key: "1000_plus", label: "Over £1,000 a month" },
] as const;

export const SCORE_LABELS: Record<keyof ReviewScores, string> = {
  setup: "Setting it up",
  support: "Support after go-live",
  value: "Value for money",
  xero_sync: "Sync with Xero",
};

const score = z.number().int().min(1).max(5);
export const ReviewInput = z.object({
  appId: z.string().min(1).max(64),
  role: z.enum(ROLES.map((r) => r.key) as [string, ...string[]]),
  scores: z.object({ setup: score, support: score, value: score, xero_sync: score }),
  priceBand: z.enum(PRICE_BANDS.map((p) => p.key) as [string, ...string[]]).nullable().optional(),
  body: z.string().trim().min(30, "Write at least a couple of sentences (30 characters)").max(3000),
});
export const FollowupInput = z.object({ supportScore: score, note: z.string().trim().max(1000).optional() });

const appName = (id: string) => catalogApps().find((a) => a.id === id)?.name ?? id;

async function audit(actor: string, action: string, target: Record<string, unknown>) {
  const db = await adminDb();
  await db.insert(auditLog).values({ actor, action, target });
}

async function queueForModeration(r: { id: string; orgId: string; appId: string }, submittedAt: Date) {
  await enqueue({
    kind: "review_moderation",
    orgId: r.orgId,
    // submitted_at makes an edited review a new item, so each version is checked.
    ref: { review_id: r.id, submitted_at: submittedAt.toISOString() },
    reason:
      `New review of ${appName(r.appId)}. Publish unless it breaks the rules: not about the product, contains personal data, or is abusive. ` +
      "Never reject a review for being negative.",
  });
}

/** Apps this business can review (2+ months of bills), with any review it already wrote. */
export async function reviewable(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const det = await tx.select().from(detectedApps);
    const mine = await tx.select().from(reviews);
    return det
      .filter((d) => d.monthsSeen >= MIN_MONTHS && catalogApps().some((a) => a.id === d.appId && !a.categories.includes("accounting")))
      .map((d) => ({ appId: d.appId, name: appName(d.appId), monthsSeen: d.monthsSeen, review: mine.find((r) => r.appId === d.appId) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

/** Write or edit this business's review of an app. Always (re)enters moderation. */
export async function submitReview(orgId: string, userId: string | null, input: z.infer<typeof ReviewInput>) {
  const { det, existing, org } = await withOrg(orgId, async (tx) => ({
    det: (await tx.select().from(detectedApps).where(eq(detectedApps.appId, input.appId)))[0],
    existing: (await tx.select().from(reviews).where(eq(reviews.appId, input.appId)))[0],
    org: (await tx.select().from(orgs).where(eq(orgs.id, orgId)))[0],
  }));
  if (!det || det.monthsSeen < MIN_MONTHS) {
    throw new HttpError(422, `We can only take a review of an app whose bills we've seen in your Xero for ${MIN_MONTHS} months or more.`);
  }
  const sample = Boolean(org?.sample);
  const fields = { role: input.role, scores: input.scores, priceBand: input.priceBand ?? null, body: input.body, verifiedMonths: det.monthsSeen, userId };
  const now = new Date();
  let row;
  if (existing) {
    // Any edit (even of a published review) goes back to pending and is checked again.
    const db = await adminDb();
    [row] = await db
      .update(reviews)
      .set({ ...fields, status: "pending", publishedAt: null, createdAt: now })
      .where(and(eq(reviews.id, existing.id), eq(reviews.orgId, orgId)))
      .returning();
  } else {
    [row] = await withOrg(orgId, (tx) => tx.insert(reviews).values({ ...fields, orgId, appId: input.appId, sample, createdAt: now }).returning());
  }
  if (!row) throw new HttpError(409, "Couldn't save the review");
  await audit(userId ?? "user", existing ? "review.edited" : "review.submitted", { review_id: row.id, org_id: orgId, app_id: input.appId, sample });
  if (!sample) await queueForModeration(row, now);
  return row;
}

export async function withdrawReview(orgId: string, userId: string | null, reviewId: string) {
  const db = await adminDb();
  const [row] = await db
    .update(reviews)
    .set({ status: "withdrawn" })
    .where(and(eq(reviews.id, reviewId), eq(reviews.orgId, orgId)))
    .returning();
  if (!row) throw new HttpError(404, "Review not found");
  await audit(userId ?? "user", "review.withdrawn", { review_id: reviewId, org_id: orgId });
  return row;
}

/** 90-day re-rate of support after go-live. Allowed once, 90+ days after the review was written. */
export async function addFollowup(orgId: string, userId: string | null, reviewId: string, input: z.infer<typeof FollowupInput>, now = new Date()) {
  const f = await withOrg(orgId, async (tx) => {
    const [r] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!r) throw new HttpError(404, "Review not found");
    const days = (now.getTime() - r.createdAt.getTime()) / 86_400_000;
    if (days < FOLLOWUP_DAY) throw new HttpError(422, `The follow-up opens ${FOLLOWUP_DAY} days after you wrote the review.`);
    const [row] = await tx
      .insert(reviewFollowups)
      .values({ reviewId, orgId, day: FOLLOWUP_DAY, supportScore: input.supportScore, note: input.note ?? null })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new HttpError(409, "You've already done the 90-day follow-up for this review");
    return row;
  });
  // Owner-connection writes go after the tenant transaction (one connection in PGlite; it would wait on itself).
  await audit(userId ?? "user", "review.followup", { review_id: reviewId, org_id: orgId, support: input.supportScore });
  return f;
}

/** Called by the queue resolver (owner connection). */
export async function moderate(reviewId: string, action: "publish" | "reject") {
  const db = await adminDb();
  const [row] = await db
    .update(reviews)
    .set(action === "publish" ? { status: "published", publishedAt: new Date() } : { status: "rejected" })
    .where(and(eq(reviews.id, reviewId), eq(reviews.status, "pending"), eq(reviews.sample, false)))
    .returning();
  if (!row) throw new HttpError(409, "That review isn't waiting for a check any more (edited, withdrawn or already done)");
  return row;
}

export async function addVendorReply(reviewId: string, vendorName: string, body: string, actor: string) {
  const db = await adminDb();
  const [r] = await db.select().from(reviews).where(and(eq(reviews.id, reviewId), eq(reviews.status, "published")));
  if (!r) throw new HttpError(404, "Published review not found");
  const row = { reviewId, vendorName, body, enteredBy: actor, createdAt: new Date() };
  await db.insert(vendorReplies).values(row).onConflictDoUpdate({ target: vendorReplies.reviewId, set: row });
  await audit(actor, "review.vendor_reply", { review_id: reviewId, vendor: vendorName });
  return row;
}

export type PublicReview = {
  id: string;
  role: string;
  scores: ReviewScores;
  priceBand: string | null;
  body: string;
  verifiedMonths: number;
  incentivised: boolean;
  publishedAt: Date;
  followupSupport: number | null;
  reply: { vendorName: string; body: string; createdAt: Date } | null;
};

/** Published reviews for an app, newest first. Never names the business. */
export async function publicReviews(appId: string): Promise<{ reviews: PublicReview[]; averages: Record<keyof ReviewScores, number> | null }> {
  const db = await adminDb();
  const rows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.appId, appId), eq(reviews.status, "published"), eq(reviews.sample, false)))
    .orderBy(desc(reviews.publishedAt));
  if (!rows.length) return { reviews: [], averages: null };
  const ids = rows.map((r) => r.id);
  const fus = await db.select().from(reviewFollowups).where(inArray(reviewFollowups.reviewId, ids));
  const reps = await db.select().from(vendorReplies).where(inArray(vendorReplies.reviewId, ids));
  const out = rows.map((r) => {
    const rep = reps.find((x) => x.reviewId === r.id);
    return {
      id: r.id,
      role: r.role,
      scores: r.scores,
      priceBand: r.priceBand,
      body: r.body,
      verifiedMonths: r.verifiedMonths,
      incentivised: r.incentivised,
      publishedAt: r.publishedAt!,
      followupSupport: fus.find((f) => f.reviewId === r.id)?.supportScore ?? null,
      reply: rep ? { vendorName: rep.vendorName, body: rep.body, createdAt: rep.createdAt } : null,
    };
  });
  const avg = (k: keyof ReviewScores) => Math.round((out.reduce((s, r) => s + r.scores[k], 0) / out.length) * 10) / 10;
  return { reviews: out, averages: { setup: avg("setup"), support: avg("support"), value: avg("value"), xero_sync: avg("xero_sync") } };
}

/**
 * peer_results for ranking (BACKEND.md §8.3): mean review score scaled to 0–1, using the 90-day support re-rate
 * where there is one. Only for apps with MIN_FOR_RANKING+ published reviews; others stay neutral.
 */
export function peerResultFrom(rows: { scores: ReviewScores; followupSupport: number | null }[]): number | null {
  if (rows.length < MIN_FOR_RANKING) return null;
  const per = rows.map((r) => (r.scores.setup + (r.followupSupport ?? r.scores.support) + r.scores.value + r.scores.xero_sync) / 4);
  return Math.round(((per.reduce((a, b) => a + b, 0) / per.length - 1) / 4) * 1000) / 1000;
}

export async function peerResults(appIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!appIds.length) return out;
  const db = await adminDb();
  const rows = await db
    .select({ id: reviews.id, appId: reviews.appId, scores: reviews.scores })
    .from(reviews)
    .where(and(inArray(reviews.appId, appIds), eq(reviews.status, "published"), eq(reviews.sample, false)));
  if (!rows.length) return out;
  const fus = await db.select().from(reviewFollowups).where(inArray(reviewFollowups.reviewId, rows.map((r) => r.id)));
  for (const appId of new Set(rows.map((r) => r.appId))) {
    const v = peerResultFrom(rows.filter((r) => r.appId === appId).map((r) => ({ scores: r.scores, followupSupport: fus.find((f) => f.reviewId === r.id)?.supportScore ?? null })));
    if (v !== null) out.set(appId, v);
  }
  return out;
}

/** This business's own reviews (any status), for its reviews page. */
export async function myReviews(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const rows = await tx.select().from(reviews).orderBy(desc(reviews.createdAt));
    const fus = rows.length ? await tx.select().from(reviewFollowups).where(inArray(reviewFollowups.reviewId, rows.map((r) => r.id))) : [];
    const now = Date.now();
    return rows.map((r) => {
      const followup = fus.find((f) => f.reviewId === r.id) ?? null;
      const followupDue = !followup && r.status === "published" && now - r.createdAt.getTime() >= FOLLOWUP_DAY * 86_400_000;
      return { ...r, name: appName(r.appId), followup, followupDue };
    });
  });
}
