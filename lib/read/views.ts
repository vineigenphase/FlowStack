/** Read models for the API (BACKEND.md §13). All reads run inside withOrg, so RLS scopes them. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { detectedApps, flags, orgs, recommendations, shortlist, statementLines, statements, syncRuns } from "@/db/schema";
import { withOrg, type Db } from "@/lib/db/client";
import { accountCategories, appCategories, apps as catalogApps, rulesFile } from "@/lib/catalog/load";
import { buildStackMap } from "@/lib/map/build";
import { SECTION_LABELS } from "@/lib/statements/build";
import { atStake } from "@/lib/signals/compute";
import { kpis } from "@/lib/statements/kpis";

const LABELS = { pl: "Profit and loss", bs: "Balance sheet", cf: "Cash flow (derived from your balance sheet)" } as const;

async function latestRun(tx: Db) {
  const [s] = await tx.select({ runId: statements.runId }).from(statements).orderBy(desc(statements.createdAt)).limit(1);
  return s?.runId ?? null;
}

async function stmt(tx: Db, runId: string, kind: "pl" | "bs" | "cf") {
  const rows = await tx.select().from(statements).where(and(eq(statements.runId, runId), eq(statements.kind, kind)));
  return rows.sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0] ?? null;
}

const appName = (id: string) => catalogApps().find((a) => a.id === id)?.name ?? id;

export async function statementView(orgId: string, kind: "pl" | "bs" | "cf") {
  return withOrg(orgId, async (tx) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
    const runId = await latestRun(tx);
    if (!runId) return null;
    const s = await stmt(tx, runId, kind);
    if (!s) return null;
    const lines = await tx.select().from(statementLines).where(eq(statementLines.statementId, s.id));
    const fl = await tx.select().from(flags).where(and(eq(flags.runId, runId), eq(flags.statementKind, kind)));
    const byKey = new Map(fl.map((f) => [f.lineKey, f]));
    const recs = fl.length ? await tx.select().from(recommendations).where(inArray(recommendations.flagId, fl.map((f) => f.id))) : [];
    const pl = kind === "pl" ? s : await stmt(tx, runId, "pl");
    const bs = kind === "bs" ? s : await stmt(tx, runId, "bs");
    const base = kind === "bs" ? { label: "Total assets", value: bs?.totals.total_assets ?? 0 } : { label: "Revenue", value: pl?.totals.revenue ?? 0 };

    const sections = new Map<string, { key: string; label: string; lines: unknown[] }>();
    for (const l of lines.sort((a, b) => a.sort - b.sort)) {
      const f = byKey.get(l.lineKey);
      const top = f ? recs.filter((r) => r.flagId === f.id).sort((a, b) => a.rank - b.rank)[0] : undefined;
      const sec = sections.get(l.section) ?? { key: l.section, label: SECTION_LABELS[l.section] ?? l.section, lines: [] };
      sec.lines.push({
        key: l.lineKey,
        code: l.code,
        name: l.name,
        value: l.value,
        share: base.value ? Math.round((Math.abs(l.value) / Math.abs(base.value)) * 10_000) / 10_000 : null,
        band: f?.band ?? null,
        state: f?.state ?? "fine",
        flagId: f?.id ?? null,
        topApp: top ? { id: top.appId, name: appName(top.appId), match: Math.round(top.match), inUse: top.inUse } : null,
      });
      sections.set(l.section, sec);
    }
    return {
      kind,
      label: LABELS[kind],
      period: s.periodFrom ? { label: "Year to date", from: s.periodFrom, to: s.periodTo } : { label: `As at ${s.periodTo}`, from: null, to: s.periodTo },
      derived: s.derived,
      ...(kind === "cf"
        ? { reconciled: s.reconciled, unexplained: s.reconciled ? 0 : Math.abs(s.reconDiff ?? 0), message: s.reconciled ? null : `Cash flow doesn't reconcile yet: £${Math.abs(s.reconDiff ?? 0).toFixed(2)} unexplained` }
        : {}),
      base,
      totals: s.totals,
      sections: [...sections.values()],
      sample: Boolean(org?.sample),
    };
  });
}

/** Gross margin, labour share and net income share from the latest P&L (BACKEND.md §18 KPIs). */
export async function kpiView(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const runId = await latestRun(tx);
    if (!runId) return null;
    const pl = await stmt(tx, runId, "pl");
    if (!pl) return null;
    const lines = await tx.select({ category: statementLines.category, value: statementLines.value }).from(statementLines).where(eq(statementLines.statementId, pl.id));
    return { ...kpis(lines, pl.totals), period: { from: pl.periodFrom, to: pl.periodTo } };
  });
}

export async function summaryView(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
    const [run] = await tx.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1);
    const runId = await latestRun(tx);
    if (!org) return null;
    if (!runId) return { org: { id: org.id, name: org.name }, lastRun: run ?? null, ready: false, sample: org.sample };
    const fl = await tx.select().from(flags).where(eq(flags.runId, runId));
    const lines = await tx.select({ lineKey: statementLines.lineKey, category: statementLines.category }).from(statementLines).innerJoin(statements, eq(statements.id, statementLines.statementId)).where(and(eq(statements.runId, runId), eq(statements.kind, "pl")));
    const catOf = new Map(lines.map((l) => [l.lineKey, l.category]));
    const revenueCats = new Set(accountCategories().filter((c) => c.revenue).map((c) => c.key));
    const det = await tx.select().from(detectedApps);
    const recs = fl.length ? await tx.select().from(recommendations).where(inArray(recommendations.flagId, fl.map((f) => f.id))) : [];
    const sl = await tx.select().from(shortlist);
    const finance = det.filter((d) => d.present && !catalogApps().find((a) => a.id === d.appId)?.categories.some((c) => c === "accounting" || c === "other_software"));
    const countOf = (state: string) => fl.filter((f) => f.state === state).length;
    const counts = { flagged: countOf("flagged"), covered: countOf("covered"), fine: countOf("fine"), marked_fine: countOf("marked_fine"), queued: countOf("queued") };
    return {
      org: { id: org.id, name: org.name, markets: org.markets, industry: org.industry },
      ready: true,
      lastRun: run ? { id: run.id, status: run.status, finishedAt: run.finishedAt, calls: run.calls, egressBytes: run.egressBytes } : null,
      atStake: { label: "£ at stake", value: atStake(fl.map((f) => ({ kind: f.statementKind, state: f.state, value: f.value, lineKey: f.lineKey })), (k) => catOf.get(k) ?? null, revenueCats) },
      lines: { total: fl.length, ...counts },
      appsInUse: finance.map((d) => ({ id: d.appId, name: appName(d.appId), spend12m: d.spend12m, monthsSeen: d.monthsSeen })),
      appsMatched: new Set(recs.filter((r) => !r.inUse).map((r) => r.appId)).size,
      // Monthly cost needs verified price facts (M8); never estimated.
      shortlist: { count: sl.length, monthlyCost: null, note: "Prices not verified yet" },
      sample: org.sample,
    };
  });
}

export async function lineView(orgId: string, lineKey: string) {
  return withOrg(orgId, async (tx) => {
    const runId = await latestRun(tx);
    if (!runId) return null;
    const [f] = await tx.select().from(flags).where(and(eq(flags.runId, runId), eq(flags.lineKey, lineKey)));
    if (!f) return null;
    const [line] = await tx
      .select({ name: statementLines.name, code: statementLines.code, section: statementLines.section })
      .from(statementLines)
      .innerJoin(statements, eq(statements.id, statementLines.statementId))
      .where(and(eq(statements.runId, runId), eq(statementLines.lineKey, lineKey)))
      .limit(1);
    const recs = await tx.select().from(recommendations).where(eq(recommendations.flagId, f.id));
    const rule = rulesFile().rules.find((r) => r.id === f.ruleId);
    const det = await tx.select().from(detectedApps);
    return {
      key: f.lineKey,
      name: line?.name ?? f.lineKey,
      code: line?.code ?? null,
      section: line ? (SECTION_LABELS[line.section] ?? line.section) : null,
      statement: f.statementKind,
      state: f.state,
      band: f.band,
      value: f.value,
      materiality: f.materiality,
      coverageGap: f.coverageGap,
      strength: f.strength,
      flagId: f.id,
      cause: rule?.cause ?? null,
      evidence: { ...(f.evidence as object), run_id: runId },
      recommendations: recs
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({ app: { id: r.appId, name: appName(r.appId), sample: catalogApps().find((a) => a.id === r.appId)?.sample ?? true }, rank: r.rank, match: Math.round(r.match), inUse: r.inUse, kind: r.kind, reason: r.reason, components: r.components })),
      detectedInArea: det.filter((d) => (rule?.app_categories ?? []).some((c) => catalogApps().find((a) => a.id === d.appId)?.categories.includes(c))).map((d) => ({ id: d.appId, name: appName(d.appId), spend12m: d.spend12m, monthsSeen: d.monthsSeen, present: d.present })),
    };
  });
}

export async function runView(orgId: string, runId: string) {
  return withOrg(orgId, async (tx) => {
    const [r] = await tx.select().from(syncRuns).where(eq(syncRuns.id, runId));
    return r ? { id: r.id, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, steps: r.steps, calls: r.calls, egressBytes: r.egressBytes, error: r.error } : null;
  });
}

/** Lines worth a look on the latest run, biggest first (P&L against revenue, balance sheet against total assets). */
export async function flaggedLines(orgId: string, limit = 10) {
  return withOrg(orgId, async (tx) => {
    const runId = await latestRun(tx);
    if (!runId) return [];
    const fl = await tx.select().from(flags).where(and(eq(flags.runId, runId), eq(flags.state, "flagged")));
    if (!fl.length) return [];
    const names = await tx
      .select({ lineKey: statementLines.lineKey, name: statementLines.name })
      .from(statementLines)
      .innerJoin(statements, eq(statements.id, statementLines.statementId))
      .where(eq(statements.runId, runId));
    const nameOf = new Map(names.map((n) => [n.lineKey, n.name]));
    const recs = await tx.select().from(recommendations).where(inArray(recommendations.flagId, fl.map((f) => f.id)));
    const rule = (id: string | null) => rulesFile().rules.find((r) => r.id === id);
    return fl
      .sort((a, b) => b.materiality - a.materiality)
      .slice(0, limit)
      .map((f) => {
        const top = recs.filter((r) => r.flagId === f.id && !r.inUse).sort((a, b) => a.rank - b.rank)[0];
        return {
          key: f.lineKey,
          name: nameOf.get(f.lineKey) ?? f.lineKey,
          statement: f.statementKind,
          value: f.value,
          materiality: f.materiality,
          band: f.band,
          cause: rule(f.ruleId)?.cause ?? null,
          topApp: top ? { id: top.appId, name: appName(top.appId), match: Math.round(top.match) } : null,
        };
      });
  });
}

/** Stack map for the latest run (lib/map/build.ts). Null before the first refresh finishes. */
export async function stackMapView(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const runId = await latestRun(tx);
    if (!runId) return null;
    const fl = await tx.select().from(flags).where(eq(flags.runId, runId));
    const names = await tx
      .select({ lineKey: statementLines.lineKey, name: statementLines.name, code: statementLines.code, category: statementLines.category })
      .from(statementLines)
      .innerJoin(statements, eq(statements.id, statementLines.statementId))
      .where(eq(statements.runId, runId));
    const byKey = new Map(names.map((n) => [n.lineKey, n]));
    const revenueCats = new Set(accountCategories().filter((c) => c.revenue).map((c) => c.key));
    const recs = fl.length ? await tx.select().from(recommendations).where(inArray(recommendations.flagId, fl.map((f) => f.id))) : [];
    const keyOf = new Map(fl.map((f) => [f.id, f.lineKey]));
    const det = await tx.select().from(detectedApps);
    return buildStackMap({
      categories: appCategories(),
      apps: catalogApps(),
      rules: rulesFile().rules,
      inUse: det.map((d) => ({ appId: d.appId, spend12m: d.spend12m, monthsSeen: d.monthsSeen, present: d.present })),
      lines: fl.map((f) => ({
        key: f.lineKey,
        name: byKey.get(f.lineKey)?.name ?? f.lineKey,
        code: byKey.get(f.lineKey)?.code ?? null,
        kind: f.statementKind,
        state: f.state,
        value: f.value,
        materiality: f.materiality,
        ruleId: f.ruleId,
        revenue: revenueCats.has(byKey.get(f.lineKey)?.category ?? ""),
      })),
      recs: recs.map((r) => ({ lineKey: keyOf.get(r.flagId)!, appId: r.appId, rank: r.rank, match: r.match, inUse: r.inUse })),
    });
  });
}
