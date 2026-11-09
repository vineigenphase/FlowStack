/**
 * Stack map (CLAUDE.md §1.3): Xero at the core, every finance function around it, gaps highlighted.
 * Pure: takes the latest run's flags, the apps in use and the catalogue; no DB access, no ledger rows.
 *
 * Each statement line belongs to ONE function (its rule's first covered_by category, else first app category),
 * so £ figures are never counted twice. Cash flow lines are left out: they restate balance-sheet movements.
 * A function's £ at stake uses the summary's rule (flagged P&L cost lines), so the map adds up to the hero figure.
 */
import type { App, AppCategory, Rule } from "@/lib/catalog/load";

export type Link = "native" | "via_app" | "csv" | "unknown";
export type FunctionStatus = "gap" | "part_manual" | "connected" | "checking" | "quiet";

export type MapLine = { key: string; name: string; code: string | null; kind: "pl" | "bs" | "cf"; state: string; value: number; materiality: number; ruleId: string | null; revenue?: boolean };
export type MapInUse = { appId: string; spend12m: number; monthsSeen: number; present: boolean };
export type MapRec = { lineKey: string; appId: string; rank: number; match: number; inUse: boolean };

export type MapApp = { id: string; name: string; link: Link; via: string | null; spend12m: number; monthsSeen: number; sample: boolean };
export type MapFunction = {
  key: string;
  label: string;
  status: FunctionStatus;
  apps: MapApp[];
  lines: { key: string; name: string; code: string | null; state: string; value: number }[];
  atStake: number;
  suggestion: { id: string; name: string; match: number; worksWith: string[]; sample: boolean } | null;
};
export type MapFix = { n: number; kind: "add" | "change"; fn: string; fnLabel: string; title: string; why: string; lineKeys: string[]; atStake: number };

/** Categories that aren't finance functions on the map. */
const OFF_MAP = new Set(["accounting", "other_software"]);

export function homeCategory(rule: Rule | undefined): string | null {
  if (!rule) return null;
  return rule.covered_by?.[0] ?? rule.app_categories[0] ?? null;
}

/** How an in-use app reaches Xero: directly, through another app they use, by CSV, or not in our catalogue. */
export function linkToXero(app: App, inUse: Set<string>, byId: Map<string, App>): { link: Link; via: string | null } {
  const direct = app.integrations.find((i) => i.to === "xero");
  if (direct?.kind === "native") return { link: "native", via: null };
  for (const i of app.integrations) {
    if (i.to === "xero" || !inUse.has(i.to) || i.kind === "csv") continue;
    const bridge = byId.get(i.to);
    if (bridge?.integrations.some((j) => j.to === "xero" && j.kind === "native")) return { link: "via_app", via: bridge.name };
  }
  if (direct) return { link: direct.kind === "csv" ? "csv" : direct.kind, via: null };
  return { link: "unknown", via: null };
}

const abs = Math.abs;
/** Biggest £ at stake first; lines with no £ (balances, revenue) break ties by how many are flagged. */
const byWeight = (a: MapFunction, b: MapFunction) =>
  b.atStake - a.atStake || b.lines.filter((l) => l.state === "flagged").length - a.lines.filter((l) => l.state === "flagged").length;

export function buildStackMap(i: {
  categories: AppCategory[];
  apps: App[];
  rules: Rule[];
  inUse: MapInUse[];
  lines: MapLine[];
  recs: MapRec[];
}): { core: { apps: MapApp[] }; functions: MapFunction[]; fixes: MapFix[] } {
  const byId = new Map(i.apps.map((a) => [a.id, a]));
  const ruleById = new Map(i.rules.map((r) => [r.id, r]));
  const present = i.inUse.filter((u) => u.present && byId.has(u.appId));
  const presentIds = new Set(present.map((u) => u.appId));

  const mapApp = (u: MapInUse): MapApp => {
    const a = byId.get(u.appId)!;
    const { link, via } = linkToXero(a, presentIds, byId);
    return { id: a.id, name: a.name, link, via, spend12m: u.spend12m, monthsSeen: u.monthsSeen, sample: a.sample };
  };

  const functions: MapFunction[] = i.categories
    .filter((c) => !OFF_MAP.has(c.key))
    .map((c) => {
      const apps = present.filter((u) => byId.get(u.appId)!.categories.includes(c.key)).map(mapApp);
      const lines = i.lines
        .filter((l) => l.kind !== "cf" && homeCategory(ruleById.get(l.ruleId ?? "")) === c.key && l.state !== "fine")
        .sort((a, b) => b.materiality - a.materiality);
      const flagged = lines.filter((l) => l.state === "flagged");
      // Same rule as the summary's hero figure (signals/compute.ts atStake): flagged P&L cost lines only.
      const atStake = Math.round(flagged.filter((l) => l.kind === "pl" && !l.revenue).reduce((s, l) => s + abs(l.value), 0) * 100) / 100;

      const byHand = apps.some((a) => a.link === "csv");
      const status: FunctionStatus = flagged.length
        ? apps.length
          ? "part_manual"
          : "gap"
        : apps.length
          ? byHand
            ? "part_manual"
            : "connected"
          : lines.some((l) => l.state === "queued")
            ? "checking"
            : "quiet";

      // Best app we'd add here: top-ranked, not in use, in this function, across its flagged lines.
      const keys = new Set(flagged.map((l) => l.key));
      const best = i.recs
        .filter((r) => keys.has(r.lineKey) && !r.inUse && byId.get(r.appId)?.categories.includes(c.key))
        .sort((a, b) => a.rank - b.rank || b.match - a.match)[0];
      const bestApp = best ? byId.get(best.appId)! : null;
      const worksWith = bestApp
        ? bestApp.integrations.filter((x) => x.to !== "xero" && presentIds.has(x.to) && x.kind !== "csv").map((x) => byId.get(x.to)!.name)
        : [];

      return {
        key: c.key,
        label: c.label,
        status,
        apps,
        lines: lines.map((l) => ({ key: l.key, name: l.name, code: l.code, state: l.state, value: l.value })),
        atStake,
        suggestion: bestApp && best ? { id: bestApp.id, name: bestApp.name, match: Math.round(best.match), worksWith, sample: bestApp.sample } : null,
      };
    });

  // Steps in order (v1.1 F): Add where nothing covers a function, Change where an app is in use but a different
  // one ranks higher there. No built-in preference between the two: biggest £ at stake first. A function whose
  // in-use app is still the best match gets no step (its card already shows the lines worth a look).
  const steps = functions
    .filter((f) => f.status === "gap" || (f.status === "part_manual" && f.suggestion))
    .sort(byWeight);
  const fixes: MapFix[] = steps.map((f, idx) => {
    const flaggedKeys = f.lines.filter((l) => l.state === "flagged").map((l) => l.key);
    const s = f.suggestion;
    if (f.status === "part_manual" && s) {
      const names = f.apps.map((a) => a.name).join(" and ");
      const csv = f.apps.find((a) => a.link === "csv");
      return {
        n: idx + 1,
        kind: "change",
        fn: f.key,
        fnLabel: f.label,
        title: `Consider changing ${names} to ${s.name}`,
        why: [
          csv ? `${csv.name} reaches Xero by CSV import, which someone does by hand.` : `${s.name} scores higher here than ${names} (${s.match}%).`,
          s.worksWith.length ? `It works directly with ${s.worksWith.join(" and ")}, which you keep.` : "",
          "Your current app is shown next to it, so it's your call.",
        ]
          .filter(Boolean)
          .join(" "),
        lineKeys: flaggedKeys,
        atStake: f.atStake,
      };
    }
    return {
      n: idx + 1,
      kind: "add",
      fn: f.key,
      fnLabel: f.label,
      title: s ? `Add an app for ${f.label.toLowerCase()} (best match: ${s.name})` : `Add an app for ${f.label.toLowerCase()}`,
      why: s?.worksWith.length ? `Nothing in use here yet. ${s.name} works directly with ${s.worksWith.join(" and ")}, which you keep.` : "Nothing in use here yet.",
      lineKeys: flaggedKeys,
      atStake: f.atStake,
    };
  });

  const core = { apps: present.filter((u) => byId.get(u.appId)!.categories.includes("accounting")).map(mapApp) };
  return { core, functions, fixes };
}
