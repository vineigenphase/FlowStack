/**
 * ENGINE-V2 §1.2 rating_score: Bayesian average (n × R + m × C) / (n + m), m = rating_prior_count, C = mean rating of
 * the rated candidates for the line; then (bayes − 1) / 4. No rating (no reviews, or no listing) → missing.
 * The raw Xero rating is shown unchanged; only this derived score is adjusted.
 */
import type { ScoringV2 } from "@/lib/catalog/load";
import type { V2App } from "./apps";
import { clamp01, missingInput, type Input } from "./part";

export function categoryMeanRating(apps: V2App[]): number | null {
  const rated = apps.map((a) => a.listing).filter((l) => l && l.rating_avg !== null && (l.review_count ?? 0) > 0);
  return rated.length ? rated.reduce((s, l) => s + l!.rating_avg!, 0) / rated.length : null;
}

export function ratingScore(app: V2App, mean: number | null, s: ScoringV2): Input {
  const l = app.listing;
  if (!l) return missingInput(s.neutral, "No Xero listing");
  if (l.rating_avg === null || !l.review_count) return missingInput(s.neutral, "No Xero reviews yet", { rating: null, reviews: l.review_count });
  const m = s.rating_prior_count;
  const C = mean ?? l.rating_avg;
  const bayes = (l.review_count * l.rating_avg + m * C) / (l.review_count + m);
  return {
    raw: { rating: l.rating_avg, reviews: l.review_count, prior_mean: Math.round(C * 100) / 100, prior_count: m, bayes: Math.round(bayes * 1000) / 1000 },
    normalised: clamp01((bayes - 1) / 4),
    missing: false,
    note: `${l.rating_avg} from ${l.review_count} reviews`,
    source: { label: "Xero App Store", url: l.source_url ?? undefined, capturedAt: l.captured_at },
  };
}
