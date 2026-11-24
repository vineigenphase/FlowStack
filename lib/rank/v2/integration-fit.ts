/**
 * ENGINE-V2 §1.2 integration_fit: v1's fitWithInUse (native 1.0, via app 0.8, CSV 0.6, none 0.3, no kept apps 0.5).
 * Integration edges are hand-entered for catalogue apps only. A catalogue app with no edge to the apps kept scores
 * "none" (0.3), which means "no known integration", not "checked and absent". A directory app has no edges entered at
 * all, so it scores the same "none" (deviation from §1.2's missing → 0.5, 23 Nov 2026, NOTES): scoring it 0.5 put
 * every unchecked app 4.2 points ahead of the catalogue apps we know best (Chaser ranked #53 for receivables).
 */
import type { App, ScoringV2 } from "@/lib/catalog/load";
import { fitWithInUse } from "@/lib/rank/score";
import type { V2App } from "./apps";
import type { Input } from "./part";

const NOT_KEPT = new Set(["accounting", "other_software"]);

export function integrationFit(app: V2App, kept: App[], s: ScoringV2): Input {
  const f = s.integration_fit;
  const others = kept.filter((k) => k.id !== app.id && !k.categories.some((c) => NOT_KEPT.has(c)));
  if (!others.length) return { raw: "no apps kept", normalised: f.no_apps!, missing: false, note: "You don't keep other finance apps yet" };
  if (!app.curated)
    return { raw: { kind: "none", checked: false }, normalised: f.none!, missing: false, note: `No known integration with ${others.map((o) => o.name).join(", ")} (this app's integrations aren't entered yet)` };
  const fit = fitWithInUse(app.curated, others, {
    weights: { strength: 0, fit_with_in_use: 0, peer_results: 0, price_fit: 0 },
    fit: { native: f.native!, via_app: f.via_app!, csv: f.csv!, none: f.none!, no_apps: f.no_apps! },
    neutral: s.neutral,
  });
  const note = fit.with
    ? `${fit.kind === "native" ? "Works directly with" : fit.kind === "via_app" ? "Connects via another app to" : "CSV import from"} ${fit.with.name}`
    : `No checked integration with ${others.map((o) => o.name).join(", ")}`;
  return { raw: fit.with ? { with: fit.with.id, kind: fit.kind } : { kind: fit.kind }, normalised: fit.score, missing: false, note, source: { label: "catalog/apps.yaml integrations (hand-checked)" } };
}
