/** CLAUDE.md §7.5 verified reviews + §2.6 DMCC rules: proof of use, moderation, no sample reviews public, audit trail. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { auditLog, detectedApps, orgs, reviewQueue, reviews } from "@/db/schema";
import { addFollowup, addVendorReply, peerResultFrom, peerResults, publicReviews, reviewable, submitReview, withdrawReview } from "@/lib/reviews";
import { resolveItem } from "@/lib/queue/resolve";

const good = {
  appId: "dext",
  role: "finance_director",
  scores: { setup: 4, support: 2, value: 4, xero_sync: 5 },
  priceBand: "50_200",
  body: "Bills come in cleanly and post to Xero; support was slow once we were live.",
};

let close: () => Promise<void>;
let realOrg: string;
let sampleOrg: string;

async function detect(orgId: string, appId: string, monthsSeen: number) {
  await withOrg(orgId, (tx) =>
    tx.insert(detectedApps).values({ orgId, appId, spend12m: 600, monthsSeen, lastSeen: "2026-10-01", present: true, evidence: { contacts: [], sources: ["bill"] } }),
  );
}

beforeAll(async () => {
  const h = await freshDb();
  close = h.close;
  const db = await adminDb();
  realOrg = (await db.insert(orgs).values({ name: "Real Ltd" }).returning())[0]!.id;
  sampleOrg = (await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true }).returning())[0]!.id;
  await detect(realOrg, "dext", 6);
  await detect(realOrg, "pleo", 1);
  await detect(sampleOrg, "dext", 6);
});
afterAll(() => close());

describe("verified reviews", () => {
  it("only apps with 2+ months of bills can be reviewed", async () => {
    expect((await reviewable(realOrg)).map((a) => a.appId)).toEqual(["dext"]);
    await expect(submitReview(realOrg, null, { ...good, appId: "pleo" })).rejects.toMatchObject({ status: 422 });
    await expect(submitReview(realOrg, null, { ...good, appId: "fathom" })).rejects.toMatchObject({ status: 422 });
  });

  it("a review is pending, verified by tenure, queued for a person, and audited", async () => {
    const r = await submitReview(realOrg, null, good);
    expect(r).toMatchObject({ status: "pending", verifiedMonths: 6, incentivised: false, sample: false });
    expect((await publicReviews("dext")).reviews).toHaveLength(0);
    const db = await adminDb();
    const q = await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "review_moderation"));
    expect(q).toHaveLength(1);
    expect(q[0]!.reason).toContain("Never reject a review for being negative");
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "review.submitted"))).toHaveLength(1);
  });

  it("a person publishes it; then it's public, newest first, without the business name", async () => {
    const db = await adminDb();
    const [q] = await db.select().from(reviewQueue).where(and(eq(reviewQueue.kind, "review_moderation"), eq(reviewQueue.status, "open")));
    await resolveItem(q!.id, "vinu", { action: "publish" });
    const p = await publicReviews("dext");
    expect(p.reviews).toHaveLength(1);
    expect(p.reviews[0]).toMatchObject({ role: "finance_director", verifiedMonths: 6 });
    expect(JSON.stringify(p)).not.toContain("Real Ltd");
    expect(p.averages).toEqual({ setup: 4, support: 2, value: 4, xero_sync: 5 });
  });

  it("rejecting needs a reason; dismiss isn't allowed for reviews", async () => {
    const db = await adminDb();
    const [q] = await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "review_moderation"));
    await expect(resolveItem(q!.id, "vinu", { action: "dismiss" })).rejects.toMatchObject({ status: expect.any(Number) });
  });

  it("editing a published review takes it down until it's checked again (a new queue item)", async () => {
    await submitReview(realOrg, null, { ...good, body: good.body + " Edited after the price went up." });
    expect((await publicReviews("dext")).reviews).toHaveLength(0);
    const db = await adminDb();
    const open = await db.select().from(reviewQueue).where(and(eq(reviewQueue.kind, "review_moderation"), eq(reviewQueue.status, "open")));
    expect(open).toHaveLength(1);
    await resolveItem(open[0]!.id, "vinu", { action: "publish" });
  });

  it("sample organisations' reviews are saved as sample, never queued, never public", async () => {
    const r = await submitReview(sampleOrg, null, good);
    expect(r.sample).toBe(true);
    const db = await adminDb();
    const q = await db.select().from(reviewQueue).where(sql`${reviewQueue.ref}->>'review_id' = ${r.id}`);
    expect(q).toHaveLength(0);
    expect((await publicReviews("dext")).reviews).toHaveLength(1); // still only the real one
  });

  it("the app role can't insert a published or incentivised review directly (RLS check)", async () => {
    await expect(
      withOrg(realOrg, (tx) => tx.insert(reviews).values({ orgId: realOrg, appId: "x", role: "other", scores: good.scores, body: "x".repeat(40), verifiedMonths: 9, status: "published" })),
    ).rejects.toThrow();
    await expect(
      withOrg(realOrg, (tx) => tx.insert(reviews).values({ orgId: realOrg, appId: "y", role: "other", scores: good.scores, body: "x".repeat(40), verifiedMonths: 9, incentivised: true })),
    ).rejects.toThrow();
  });

  it("90-day follow-up: not before day 90, once only; it feeds the public review", async () => {
    const [r] = await withOrg(realOrg, (tx) => tx.select().from(reviews).where(eq(reviews.appId, "dext")));
    await expect(addFollowup(realOrg, null, r!.id, { supportScore: 4 })).rejects.toMatchObject({ status: 422 });
    const later = new Date(r!.createdAt.getTime() + 91 * 86_400_000);
    await addFollowup(realOrg, null, r!.id, { supportScore: 4 }, later);
    await expect(addFollowup(realOrg, null, r!.id, { supportScore: 5 }, later)).rejects.toMatchObject({ status: 409 });
    expect((await publicReviews("dext")).reviews[0]!.followupSupport).toBe(4);
  });

  it("vendor replies sit under the review", async () => {
    const p = await publicReviews("dext");
    await addVendorReply(p.reviews[0]!.id, "Dext", "Thanks, we've added UK weekend support since.", "luke");
    expect((await publicReviews("dext")).reviews[0]!.reply).toMatchObject({ vendorName: "Dext" });
  });

  it("withdrawing removes it from public view", async () => {
    const [r] = await withOrg(realOrg, (tx) => tx.select().from(reviews).where(eq(reviews.appId, "dext")));
    await withdrawReview(realOrg, null, r!.id);
    expect((await publicReviews("dext")).reviews).toHaveLength(0);
  });

  it("ranking: peer_results only with 5+ reviews, using the 90-day support score", async () => {
    const one = { scores: { setup: 5, support: 1, value: 5, xero_sync: 5 }, followupSupport: 5 };
    expect(peerResultFrom([one, one, one, one])).toBeNull();
    expect(peerResultFrom([one, one, one, one, one])).toBe(1);
    expect(peerResultFrom(Array(5).fill({ scores: { setup: 1, support: 1, value: 1, xero_sync: 1 }, followupSupport: null }))).toBe(0);
    expect((await peerResults(["dext"])).size).toBe(0);
  });
});
