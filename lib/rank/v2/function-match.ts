/**
 * ENGINE-V2 §1.2 function_match: share of the rule's required Xero functions the app lists, plus
 * helpful_factor × share of the helpful ones, capped at 1. No listed functions, or a rule with none → missing.
 */
import type { Rule, ScoringV2 } from "@/lib/catalog/load";
import type { V2App } from "./apps";
import { missingInput, type Input } from "./part";

export function functionMatch(app: V2App, rule: Rule, s: ScoringV2): Input {
  const req = rule.required_functions;
  const help = rule.helpful_functions;
  if (!req.length && !help.length) return missingInput(s.neutral, "This rule has no Xero functions listed yet");
  if (!app.functions.length) return missingInput(s.neutral, app.listing ? "The Xero listing doesn't say which Xero records it uses" : "No Xero listing");
  const has = new Set(app.functions);
  const reqHit = req.filter((f) => has.has(f));
  const helpHit = help.filter((f) => has.has(f));
  const share = (req.length ? reqHit.length / req.length : 0) + s.function_match.helpful_factor * (help.length ? helpHit.length / help.length : 0);
  return {
    raw: { required: reqHit, of_required: req, helpful: helpHit, of_helpful: help },
    normalised: Math.min(1, share),
    missing: false,
    note: `Uses ${reqHit.length} of ${req.length} required and ${helpHit.length} of ${help.length} helpful Xero records`,
    source: app.listing ? { label: "Xero App Store listing (data flow)", url: app.listing.source_url ?? undefined, capturedAt: app.listing.captured_at } : undefined,
  };
}
