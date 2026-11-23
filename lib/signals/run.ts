/** Load what flag computation needs for one run, compute, and store flags + recommendations. */
import { computeTrends, type Month, type TrendKey } from "./trends";
import { oneOffs } from "./one-off";
import { and, eq, inArray } from "drizzle-orm";
import { appFacts, cashflowAcceptances, detectedApps, flags, lineOverrides, orgs, recommendations, recommendationsV2, statementLines, statements, trialBalance } from "@/db/schema";
import { rankFlagsV2, type V2Line } from "@/lib/rank/v2/run";
import { shortlistV2 } from "@/lib/rank/v2/score";
import { enqueueAll, type QueueItem } from "@/lib/queue/enqueue";
import { log } from "@/lib/log";
import { withOrg, type Db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { apps as catalogApps, rulesFile } from "@/lib/catalog/load";
import { accountInfo } from "@/lib/statements/accounts";
import { computeFlags as compute, type LineIn, type TbRow } from "./compute";
import { peerResults } from "@/lib/reviews";

const CREDIT_CLASSES = new Set(["REVENUE", "LIABILITY", "EQUITY"]);
const PRICE_FIELDS = ["price_from_gbp", "price_model"];

export function monthsBetween(from: string, to: string) {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
}

const TREND_NAMES: Record<TrendKey, string> = {
  debtor_days: "Debtor days rising",
  creditor_days: "Creditor days rising",
  stock_days: "Stock days rising",
  cash_headroom_months: "Cash headroom falling",
};
/** Trends need a P&L for every month used; months without one give no trend. */
const plsComplete = (ms: Month[]) => ms.slice(0, 6).every((m) => m.revenue !== 0 || m.costOfSales !== 0 || m.overheads !== 0);

type Stmt = typeof statements.$inferSelect;

/** v1.1 B: the monthly balance sheet + P&L of a run as trend months, newest first (lines in current categories). */
export async function trendMonths(tx: Db, stmts: Stmt[], info: Awaited<ReturnType<typeof accountInfo>>) {
  const monthly = stmts.filter((s) => s.kind === "bs_monthly" || s.kind === "pl_monthly");
  const monthlyLines = monthly.length ? await tx.select().from(statementLines).where(inArray(statementLines.statementId, monthly.map((s) => s.id))) : [];
  const ends = [...new Set(monthly.filter((s) => s.kind === "bs_monthly").map((s) => s.periodTo))].sort().reverse();
  const months: Month[] = ends.map((end) => {
    const bsS = monthly.find((s) => s.kind === "bs_monthly" && s.periodTo === end);
    const plS = monthly.find((s) => s.kind === "pl_monthly" && s.periodTo === end);
    const bsByCat: Record<string, number> = {};
    for (const l of monthlyLines.filter((x) => x.statementId === bsS?.id)) {
      const cat = l.xeroAccountId ? (info.get(l.xeroAccountId)?.category ?? null) : l.category;
      if (cat) bsByCat[cat] = (bsByCat[cat] ?? 0) + l.value;
    }
    const pls = monthlyLines.filter((x) => x.statementId === plS?.id);
    const inSec = (k: string[]) => pls.filter((l) => k.includes(l.section)).reduce((t, l) => t + l.value, 0);
    return { end, bs: bsByCat, revenue: inSec(["income"]), costOfSales: inSec(["cost_of_sales"]), overheads: inSec(["opex", "other_expenses"]) };
  });
  return { months, monthly, monthlyLines, ends };
}

/** All four trends (fired or not) when there are enough complete months; otherwise none. */
export const trendsOf = (months: Month[]) => (months.length >= 6 && plsComplete(months) ? computeTrends(months, rulesFile().trends) : []);

export async function computeFlags(orgId: string, runId: string) {
  // Verified-review results are global (owner connection), so read them before the tenant transaction opens.
  const peer = await peerResults(catalogApps().map((a) => a.id));
  const res = await withOrg(orgId, async (tx) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
    const stmts = await tx.select().from(statements).where(eq(statements.runId, runId));
    const pl = stmts.find((s) => s.kind === "pl");
    const bs = stmts.filter((s) => s.kind === "bs").sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0];
    const cf = stmts.find((s) => s.kind === "cf");
    if (!org || !pl || !bs) return { flags: 0, flagged: 0, queue: [] as QueueItem[], v2: null as null | { lines: number; error?: string } };

    const ids = [pl.id, bs.id, ...(cf ? [cf.id] : [])];
    const kindOf = new Map(ids.map((id) => [id, stmts.find((s) => s.id === id)!.kind]));
    const rawLines = await tx.select().from(statementLines).where(inArray(statementLines.statementId, ids));
    const info = await accountInfo(tx);

    const lines: LineIn[] = rawLines
      .filter((l) => l.lineKey !== "bs:current_year_earnings" && l.lineKey !== "cf:net_profit")
      .map((l) => ({
        kind: kindOf.get(l.statementId)! as LineIn["kind"],
        lineKey: l.lineKey,
        xeroAccountId: l.xeroAccountId,
        code: l.code,
        name: l.name,
        category: l.xeroAccountId ? (info.get(l.xeroAccountId)?.category ?? null) : l.category,
        value: l.value,
      }));

    // v1.1 B: trends from the 12 monthly statements (when the source had them).
    const { months, monthly, monthlyLines, ends } = await trendMonths(tx, stmts, info);
    // Round-2 3c: this financial year's monthly P&L, per line, for one-off detection.
    const fyMonths = monthly.filter((s) => s.kind === "pl_monthly" && s.periodTo >= pl.periodFrom! && s.periodTo <= pl.periodTo).sort((a, b) => a.periodTo.localeCompare(b.periodTo));
    const byLine = new Map<string, Map<string, number>>();
    for (const m of fyMonths) {
      for (const l of monthlyLines.filter((x) => x.statementId === m.id)) {
        const mm = byLine.get(l.lineKey) ?? new Map<string, number>();
        mm.set(m.periodTo, (mm.get(m.periodTo) ?? 0) + l.value);
        byLine.set(l.lineKey, mm);
      }
    }
    const oneOff = pl.periodFrom ? oneOffs(fyMonths.map((m) => m.periodTo), byLine, rulesFile().one_off) : new Map();
    const trends = trendsOf(months);
    // The biggest account behind each trend's balance, for the trial balance evidence.
    const latestBs = monthly.find((s) => s.kind === "bs_monthly" && s.periodTo === ends[0]);
    const balanceAccount = (cat: string) =>
      monthlyLines
        .filter((l) => l.statementId === latestBs?.id && l.xeroAccountId && info.get(l.xeroAccountId)?.category === cat)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0] ?? null;
    for (const t of trends.filter((x) => x.fires)) {
      const acct = balanceAccount(t.balanceCategory);
      lines.push({
        kind: "trend",
        lineKey: `trend:${t.key}`,
        xeroAccountId: acct?.xeroAccountId ?? null,
        code: acct?.code ?? null,
        name: TREND_NAMES[t.key],
        category: `trend:${t.key}`,
        value: t.value,
        extra: { trend: { key: t.key, latest: t.latest, three_months_ago: t.threeMonthsAgo, change: t.change, series: t.series, formula: t.formula } },
      });
    }

    const tbRows = await tx.select().from(trialBalance).where(eq(trialBalance.runId, runId));
    const classOf = new Map(
      (await tx.query.accounts.findMany({ columns: { xeroAccountId: true, class: true } })).map((a) => [a.xeroAccountId, a.class]),
    );
    const tb = new Map<string, TbRow>(
      tbRows.map((t) => {
        const net = t.ytdDebit - t.ytdCredit;
        const signed = CREDIT_CLASSES.has(classOf.get(t.xeroAccountId) ?? "") ? -net : net;
        return [t.xeroAccountId, { code: t.code, name: t.name, ytd_net: Math.round(signed * 100) / 100, as_at: t.asAt }];
      }),
    );

    const detected = await tx.select().from(detectedApps).where(and(eq(detectedApps.orgId, orgId), eq(detectedApps.present, true)));
    const overrides = await tx.select().from(lineOverrides);
    const facts = await tx.select().from(appFacts).where(inArray(appFacts.field, PRICE_FIELDS));
    const prices = new Map<string, { known: boolean }>();
    for (const f of facts) if (f.field === "price_from_gbp" && (f.state === "verified" || f.state === "found") && f.value !== null) prices.set(f.appId, { known: true });

    // A person may accept an unreconciled cash flow; it holds only while the unexplained amount is unchanged.
    const [accepted] = cf ? await tx.select().from(cashflowAcceptances).where(eq(cashflowAcceptances.periodTo, cf.periodTo)) : [];
    const cfOk = Boolean(cf?.reconciled) || Boolean(cf && accepted && Math.abs(accepted.diff - (cf.reconDiff ?? 0)) < 1);

    const rf = rulesFile();
    const out = compute(lines, {
      revenue: pl.totals.revenue ?? 0,
      totalAssets: bs.totals.total_assets ?? 0,
      monthsInPeriod: pl.periodFrom ? monthsBetween(pl.periodFrom, pl.periodTo) : 12,
      cfReconciled: cfOk,
      rules: rf.rules,
      apps: catalogApps(),
      markets: org.markets,
      inUse: new Map(detected.map((d) => [d.appId, { appId: d.appId, spend12m: d.spend12m, monthsSeen: d.monthsSeen }])),
      prices,
      peer,
      overrides: new Map(overrides.map((o) => [`${o.lineKey}|${o.ruleId}`, { state: o.state, until: o.until, appId: o.appId }])),
      tb,
      bands: { high: env().HIGH_BAND, medium: env().MED_BAND },
      scoring: rf.scoring,
      oneOff,
    });

    // Upsert by (run, line) so flag ids — and the feedback that references them — survive a recompute.
    const keep = new Set(out.map((f) => f.lineKey));
    const existing = await tx.select({ id: flags.id, lineKey: flags.lineKey }).from(flags).where(eq(flags.runId, runId));
    const stale = existing.filter((e) => !keep.has(e.lineKey)).map((e) => e.id);
    if (stale.length) await tx.delete(flags).where(inArray(flags.id, stale));
    const flagIds = new Map<string, string>();
    for (const f of out) {
      const values = {
        orgId,
        runId,
        statementKind: f.kind,
        lineKey: f.lineKey,
        xeroAccountId: f.xeroAccountId,
        ruleId: f.ruleId,
        ruleVersion: f.ruleVersion,
        value: f.value,
        base: f.base,
        materiality: f.materiality,
        band: f.band,
        coverageGap: f.coverageGap,
        strength: f.strength,
        state: f.state,
        evidence: { ...f.evidence, cause: f.cause },
      };
      const { orgId: _o, runId: _r, lineKey: _l, ...set } = values;
      void _o;
      void _r;
      void _l;
      const [row] = await tx
        .insert(flags)
        .values(values)
        .onConflictDoUpdate({ target: [flags.runId, flags.lineKey], set })
        .returning({ id: flags.id });
      flagIds.set(f.lineKey, row!.id);
      await tx.delete(recommendations).where(eq(recommendations.flagId, row!.id));
      if (f.recommendations.length) {
        await tx.insert(recommendations).values(
          f.recommendations.map((r) => ({
            flagId: row!.id,
            orgId,
            appId: r.appId,
            rank: r.rank,
            match: r.match,
            components: r.components,
            inUse: r.inUse,
            kind: r.kind,
            reason: r.reason,
          })),
        );
      }
    }
    // ENGINE-V2 §1.3 shadow mode: rank the same flags with v2 and keep the result apart (recommendations_v2).
    // Customers still see v1. A v2 failure is logged and reported in the run result; it never fails the refresh.
    const queue: QueueItem[] = [];
    let v2: { lines: number; error?: string } = { lines: 0 };
    try {
      const months = pl.periodFrom ? monthsBetween(pl.periodFrom, pl.periodTo) : 12;
      const revenue = pl.totals.revenue ?? 0;
      const ranked: V2Line[] = rankFlagsV2({
        flags: out,
        lines,
        inUse: detected.map((d) => d.appId),
        markets: org.markets,
        annualRevenue: months > 0 ? (revenue * 12) / months : revenue,
        headcount: null,
        today: new Date().toISOString().slice(0, 10),
      });
      for (const { line, result } of ranked) {
        const flagId = flagIds.get(line.lineKey)!;
        await tx.delete(recommendationsV2).where(eq(recommendationsV2.flagId, flagId));
        const rows = shortlistV2(result.candidates);
        if (rows.length)
          await tx.insert(recommendationsV2).values(
            rows.map((r) => ({ flagId, orgId, appId: r.appId, rank: r.rank, match: r.match, components: { parts: r.parts, warnings: result.warnings }, inUse: r.inUse, kind: r.kind, reason: r.reason })),
          );
        if (result.gap && line.state === "flagged")
          queue.push({
            kind: "catalog_gap",
            orgId,
            ref: { rule_id: result.gap.ruleId, categories: result.gap.categories, markets: result.gap.markets },
            reason: `Engine v2 has only ${result.gap.candidates} app${result.gap.candidates === 1 ? "" : "s"} for ${result.gap.categories.join("/")} in ${result.gap.markets.join("/")} (line ${line.name}). Add apps to the catalogue.`,
          });
      }
      v2 = { lines: ranked.length };
    } catch (e) {
      log.error({ err: e, orgId, runId }, "engine v2 shadow ranking failed");
      v2 = { lines: 0, error: e instanceof Error ? e.message : String(e) };
    }
    return { flags: out.length, flagged: out.filter((f) => f.state === "flagged").length, queue, v2 };
  });
  // The queue is on the owner connection: write it after the tenant transaction commits.
  if (res.queue.length) await enqueueAll(res.queue);
  return { flags: res.flags, flagged: res.flagged, v2: res.v2 };
}
