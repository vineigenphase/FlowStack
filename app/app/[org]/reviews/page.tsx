import Link from "next/link";
import { requireOrgReader } from "@/lib/auth/session";
import { MIN_MONTHS, myReviews, PRICE_BANDS, reviewable, ROLES, SCORE_LABELS } from "@/lib/reviews";
import { FollowupForm, ReviewForm } from "@/components/review-form";
import { PostButton } from "@/components/post-button";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { pending: "Waiting for a check", published: "Public", rejected: "Not published", withdrawn: "Withdrawn" };

export default async function ReviewsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireOrgReader(org);
  } catch {
    return null;
  }
  const [can, mine] = await Promise.all([reviewable(org), myReviews(org)]);

  return (
    <>
      <h1>Reviews</h1>
      <p className="meta">
        You can review an app once its bills have been in your Xero for {MIN_MONTHS} months or more, so every review comes from a business that
        really pays for it. Reviews show your role and how long you&apos;ve paid, never your business name. A person checks each one before it
        appears. We don&apos;t remove reviews for being negative, and vendors can reply but can&apos;t edit, hide or reorder them.
      </p>

      {mine.length ? (
        <section>
          <h2>Your reviews</h2>
          <ul className="plain">
            {mine.map((r) => {
              return (
                <li key={r.id} className="card">
                  <span className="card-head">
                    <b>
                      <Link href={`/apps/${r.appId}`}>{r.name}</Link>
                      {r.sample ? <span className="tag">sample: never public</span> : null}
                    </b>
                    <span className="badge">{STATUS[r.status] ?? r.status}</span>
                  </span>
                  <span className="small">{r.body}</span>
                  {r.followup ? (
                    <span className="muted small">90-day support score: {r.followup.supportScore}/5</span>
                  ) : r.followupDue ? (
                    <FollowupForm org={org} reviewId={r.id} />
                  ) : null}
                  {r.status !== "withdrawn" ? (
                    <span className="card-actions small">
                      <PostButton url={`/api/orgs/${org}/reviews/${r.id}`} method="DELETE" label="Withdraw" />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="muted">No reviews yet.</p>
      )}

      <section>
        <h2>Apps you can review</h2>
        {can.length ? (
          can.map((a) => (
            <details key={a.appId} className="review-app" open={!a.review && can.length === 1}>
              <summary>
                <b>{a.name}</b> <span className="muted small">· bills seen in {a.monthsSeen} months{a.review ? " · you've reviewed it (edit below)" : ""}</span>
              </summary>
              <ReviewForm
                org={org}
                appId={a.appId}
                appName={a.name}
                roles={[...ROLES]}
                priceBands={[...PRICE_BANDS]}
                scoreLabels={SCORE_LABELS}
                initial={a.review ? { role: a.review.role, scores: a.review.scores, priceBand: a.review.priceBand, body: a.review.body } : null}
              />
            </details>
          ))
        ) : (
          <p className="muted">No app has been in your bills for {MIN_MONTHS} months yet.</p>
        )}
      </section>
    </>
  );
}
