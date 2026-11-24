/**
 * ENGINE-V2 §1.2 category_match: 1.0 if the app is in a category that handles the line (the rule's covered_by),
 * 0.7 if it is only in the rule's app_categories (it helps), otherwise 0 and it isn't a candidate.
 */
import type { Rule, ScoringV2 } from "@/lib/catalog/load";
import type { V2App } from "./apps";
import type { Input } from "./part";

export function categoryMatch(app: V2App, rule: Rule, s: ScoringV2): Input | null {
  const handles = rule.covered_by ?? rule.app_categories;
  const hit = app.categories.filter((c) => handles.includes(c));
  if (hit.length) return { raw: hit, normalised: s.category_match.covered_by, missing: false, note: `Handles the line (${hit.join(", ")})` };
  const helps = app.categories.filter((c) => rule.app_categories.includes(c));
  if (helps.length) return { raw: helps, normalised: s.category_match.app_categories_only, missing: false, note: `Helps with the line (${helps.join(", ")}) but doesn't handle it` };
  return null;
}
