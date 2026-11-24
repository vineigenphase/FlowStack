/**
 * ENGINE-V2 §1.2 volume_score: log10(1 + reviews) / log10(1 + most reviews among the line's candidates).
 * Unknown review count (no listing) → missing. A listing with 0 reviews scores 0 (known, not missing).
 */
import type { ScoringV2 } from "@/lib/catalog/load";
import type { V2App } from "./apps";
import { missingInput, type Input } from "./part";

export const maxReviews = (apps: V2App[]) => Math.max(0, ...apps.map((a) => a.listing?.review_count ?? 0));

export function volumeScore(app: V2App, max: number, s: ScoringV2): Input {
  const n = app.listing?.review_count;
  if (n === null || n === undefined) return missingInput(s.neutral, app.listing ? "Review count not shown" : "No Xero listing");
  const score = max > 0 ? Math.log10(1 + n) / Math.log10(1 + max) : 0;
  return { raw: { reviews: n, most_in_set: max }, normalised: score, missing: false, note: `${n} reviews (most in this set: ${max})`, source: app.listing ? { label: "Xero App Store", url: app.listing.source_url ?? undefined, capturedAt: app.listing.captured_at } : undefined };
}
