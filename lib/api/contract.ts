/**
 * Read models in the UI-SPEC §8 shapes (lib/api/types.ts). Routes return these; the mock files are generated from
 * them (scripts/make-mocks.ts), so the mocks can't drift from the real responses.
 *
 * Rules carried over from the spec: nothing is estimated (unknown prices stay null and are counted, never summed),
 * sample data says so, and no response carries a raw Xero payload.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  appFacts,
  detectedApps,
  flagFeedback,
  flags,
  lineOverrides,
  orgEssentials,
  orgs,
  recommendations,
  shortlist,
  statementLines,
  statements,
  subscriptions,
  syncRuns,
  users,
  xeroConnections,
} from "@/db/schema";
import { adminDb, withOrg, type Db } from "@/lib/db/client";
import { accountCategories, appCategories, apps as catalogApps, essentials as catalogEssentials, rulesFile } from "@/lib/catalog/load";
import { DISPLAY_FIELDS, FACT_LABELS, type FactField } from "@/lib/catalog/facts";
import { SECTION_LABELS } from "@/lib/statements/build";
import { accountInfo } from "@/lib/statements/accounts";
import { atStake as atStakeOf } from "@/lib/signals/compute";
import { trendMonths, trendsOf } from "@/lib/signals/run";
import { plans as planCatalog } from "@/lib/billing";
import type * as T from "./types";

// ---------- small helpers ----------

const r2 = (n: number) => Math.round(n * 100) / 100;
const app = (id: string) => catalogApps().find((a) => a.id === id);
const appName = (id: string) => app(id)?.name ?? id;
const iso = (d: Date | string | null | undefined): string | null => (d ? (typeof d === "string" ? d : d.toISOString()) : null);
const fmt = (ymd: string) => new Date(ymd + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const NOT_A_FUNCTION = new Set(["accounting", "other_software"]);

export function periodOf(from: string | null, to: string): T.Period {
  if (!from) return { label: `As at ${fmt(to)}`, from: null, to };
  const f = new Date(from + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return { label: `Year to date (${f} – ${fmt(to)})`, from, to };
}

const industryOf = (i: string | null): T.Industry | null => (i === "ecommerce" || i === "saas" ? i : i ? "other" : null);
const marketsOf = (m: string[]): T.Market[] => m.filter((x): x is T.Market => ["UK", "US", "CA", "AU"].includes(x));

// ---------- app cards and dossier ----------

type FactRowLite = { field: string; value: unknown; state: T.FactState; quote: string | null; sourceUrl: string | null; checkedAt: Date | null };

async function factsBy(appIds?: string[]): Promise<Map<string, Map<string, FactRowLite>>> {
  const db = await adminDb();
  const rows = appIds?.length
    ? await db.select().from(appFacts).where(inArray(appFacts.appId, appIds))
    : appIds
      ? []
      : await db.select().from(appFacts);
  const out = new Map<string, Map<string, FactRowLite>>();
  for (const r of rows) {
    const m = out.get(r.appId) ?? new Map();
    m.set(r.field, { field: r.field, value: r.value, state: r.state, quote: r.quote, sourceUrl: r.sourceUrl, checkedAt: r.checkedAt });
    out.set(r.appId, m);
  }
  return out;
}

/** A missing or never-checked fact never shows a value (UI-SPEC §2.2). */
function factValue<V>(f: FactRowLite | undefined, value: V | null): T.FactValue<V> {
  if (!f || f.state === "missing") return { value: null, state: "missing" };
  const out: T.FactValue<V> = { value, state: f.state };
  if (f.sourceUrl && f.checkedAt) out.source = { url: f.sourceUrl, checkedAt: f.checkedAt.toISOString().slice(0, 10) };
  if (f.quote) out.quote = f.quote;
  return out;
}

const PRICE_MODELS = new Set(["per_month", "per_user_month", "per_year", "quote", "usage"]);

function priceOf(f: Map<string, FactRowLite> | undefined): T.AppCard["price"] {
  const from = f?.get("price_from_gbp");
  const model = f?.get("price_model");
  const quoteOnly = f?.get("quote_only");
  const known = (x?: FactRowLite) => x && x.state !== "missing" && x.state !== "conflicting";
  const fromGbp = known(from) && typeof from!.value === "number" ? (from!.value as number) : null;
  const rawModel = known(model) ? String(model!.value) : quoteOnly?.value === true ? "quote" : null;
  // Which fact leads the badge: the price if we have it, else the model.
  const lead = known(from) ? from : known(model) ? model : known(quoteOnly) ? quoteOnly : from;
  if (fromGbp === null && !rawModel) return factValue<NonNullable<T.AppCard["price"]["value"]>>(lead?.state === "conflicting" ? lead : undefined, null);
  const m = (rawModel && PRICE_MODELS.has(rawModel) ? rawModel : fromGbp !== null ? "per_month" : "quote") as "per_month";
  return factValue(lead, { model: m, fromGbp });
}

export function appCardOf(id: string, facts: Map<string, Map<string, FactRowLite>>): T.AppCard {
  const a = app(id);
  return {
    id,
    name: a?.name ?? id,
    categories: a?.categories ?? [],
    markets: marketsOf(a?.markets ?? []),
    price: priceOf(facts.get(id)),
    sample: a?.sample ?? true,
  };
}

export async function appCards(filter: { category?: string; market?: string; q?: string } = {}): Promise<T.AppCard[]> {
  const q = filter.q?.trim().toLowerCase();
  const list = catalogApps()
    .filter((a) => !a.categories.some((c) => NOT_A_FUNCTION.has(c)))
    .filter((a) => !filter.category || a.categories.includes(filter.category))
    .filter((a) => !filter.market || a.markets.includes(filter.market as never))
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.categories.some((c) => c.includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name)); // alphabetical: no app pays to appear
  const facts = await factsBy();
  return list.map((a) => appCardOf(a.id, facts));
}

const GROUP: Record<FactField, T.AppDossier["facts"][string]["group"]> = {
  price_model: "price",
  price_from_gbp: "price",
  setup_fee: "price",
  quote_only: "price",
  min_term: "contract",
  notice_period: "contract",
  auto_renew: "contract",
  data_export: "contract",
  posts_to_xero_as: "fit",
  tracking_categories: "fit",
  security_certs: "security",
  data_location: "security",
  support_hours: "support",
  days_to_go_live: "going_live",
  vendor_incorporated: "vendor",
  vendor_ownership_changes: "vendor",
};

export async function dossier(id: string, orgId?: string): Promise<T.AppDossier | null> {
  const a = app(id);
  if (!a) return null;
  const f = (await factsBy([id])).get(id);
  const used = orgId ? new Set((await withOrg(orgId, (tx) => tx.select().from(detectedApps))).filter((d) => d.present).map((d) => d.appId)) : new Set<string>();
  const facts: T.AppDossier["facts"] = {};
  for (const field of DISPLAY_FIELDS) facts[field] = { ...factValue(f?.get(field), f?.get(field)?.value ?? null), group: GROUP[field], label: FACT_LABELS[field] };
  return {
    app: { id: a.id, name: a.name, website: a.website ?? "", categories: a.categories, markets: marketsOf(a.markets), sample: a.sample },
    facts,
    integrations: a.integrations.map((i) => ({ toAppId: i.to, toName: i.to === "xero" ? "Xero" : appName(i.to), kind: i.kind, usedByOrg: i.to === "xero" || used.has(i.to) })),
  };
}

// ---------- one run's lines, flags and recommendations ----------

type Facts = Awaited<ReturnType<typeof factsBy>>;
type Run = Awaited<ReturnType<typeof loadRun>>;
/** Global reads (facts, users) happen outside withOrg: the owner connection is never used inside a tenant transaction. */

async function latestRunId(tx: Db) {
  const [s] = await tx.select({ runId: statements.runId }).from(statements).orderBy(desc(statements.createdAt)).limit(1);
  return s?.runId ?? null;
}

/** Everything the line views need from the latest run, in one pass. */
async function loadRun(tx: Db, facts: Facts) {
  const runId = await latestRunId(tx);
  if (!runId) return null;
  const stmts = await tx.select().from(statements).where(eq(statements.runId, runId));
  const fl = await tx.select().from(flags).where(eq(flags.runId, runId));
  const recs = fl.length ? await tx.select().from(recommendations).where(inArray(recommendations.flagId, fl.map((f) => f.id))) : [];
  const overrides = await tx.select().from(lineOverrides);
  const fb = fl.length ? await tx.select().from(flagFeedback).where(inArray(flagFeedback.flagId, fl.map((f) => f.id))).orderBy(desc(flagFeedback.createdAt)) : [];
  const latestFb = new Map<string, (typeof fb)[number]>();
  for (const r of fb) if (!latestFb.has(r.flagId)) latestFb.set(r.flagId, r);
  const main = (k: "pl" | "bs" | "cf") => stmts.filter((s) => s.kind === k).sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0] ?? null;
  const pl = main("pl");
  const bs = main("bs");
  const cf = main("cf");
  const mainIds = [pl, bs, cf].filter(Boolean).map((s) => s!.id);
  const lines = mainIds.length ? await tx.select().from(statementLines).where(inArray(statementLines.statementId, mainIds)) : [];
  return { runId, stmts, pl, bs, cf, lines, flags: fl, recs, overrides, latestFb, facts };
}

const flagKey = (kind: string, lineKey: string) => `${kind}|${lineKey}`;

function baseOf(run: NonNullable<Run>, kind: T.StatementKind | "trend") {
  return kind === "bs" ? { label: "Total assets", value: run.bs?.totals.total_assets ?? 0 } : { label: "Revenue", value: run.pl?.totals.revenue ?? 0 };
}

function lineOf(run: NonNullable<Run>, kind: T.StatementKind | "trend", l: { lineKey: string; code: string | null; name: string; value: number }): T.Line {
  const f = run.flags.find((x) => x.statementKind === kind && x.lineKey === l.lineKey);
  const base = baseOf(run, kind);
  const recs = f ? run.recs.filter((r) => r.flagId === f.id).sort((a, b) => a.rank - b.rank) : [];
  const top = recs.find((r) => !r.inUse) ?? recs[0];
  const coveredId = f?.state === "covered" ? ((f.evidence as { covered_by?: string }).covered_by ?? null) : null;
  const ov = f?.ruleId ? run.overrides.find((o) => o.lineKey === l.lineKey && o.ruleId === f.ruleId) : undefined;
  const fb = f ? run.latestFb.get(f.id) : undefined;
  return {
    key: l.lineKey,
    code: l.code,
    name: l.name,
    value: l.value,
    share: base.value ? Math.round((Math.abs(l.value) / Math.abs(base.value)) * 10_000) / 10_000 : null,
    band: f && f.state !== "fine" ? f.band : null,
    state: (f?.state ?? "fine") as T.LineState,
    flagId: f?.id ?? null,
    topApp: top ? { id: top.appId, name: appName(top.appId), match: Math.round(top.match) } : null,
    coveredBy: coveredId ? { id: coveredId, name: appName(coveredId) } : null,
    oneOffNote:
      fb?.answer === "numbers_wrong" && fb.subReason === "one_off"
        ? "You said this is a one-off cost"
        : ((f?.evidence as { one_off?: { note: string } } | undefined)?.one_off?.note ?? null),
    snoozedUntil: f?.state === "snoozed" ? (ov?.until ?? null) : null,
  };
}

// ---------- statements ----------

const LABELS: Record<T.StatementKind, string> = { pl: "Profit and loss", bs: "Balance sheet", cf: "Cash flow" };

export async function statement(orgId: string, kind: T.StatementKind, opts: { months?: number } = {}): Promise<T.Statement | null> {
  const facts = await factsBy();
  return withOrg(orgId, async (tx) => {
    const run = await loadRun(tx, facts);
    if (!run) return null;
    const s = kind === "pl" ? run.pl : kind === "bs" ? run.bs : run.cf;
    if (!s) return null;
    const [org] = await tx.select({ sample: orgs.sample }).from(orgs).where(eq(orgs.id, orgId));

    // Monthly columns, oldest first; an account missing from a month's report had a zero balance that month.
    let months: string[] | undefined;
    let monthlyBy: Map<string, number[]> | undefined;
    if (opts.months) {
      const mk = `${kind}_monthly`;
      const ms = run.stmts.filter((x) => x.kind === mk).sort((a, b) => a.periodTo.localeCompare(b.periodTo)).slice(-opts.months);
      if (ms.length) {
        months = ms.map((m) => m.periodTo);
        const ml = await tx.select().from(statementLines).where(inArray(statementLines.statementId, ms.map((m) => m.id)));
        monthlyBy = new Map();
        ms.forEach((m, i) => {
          for (const l of ml.filter((x) => x.statementId === m.id)) {
            const arr = monthlyBy!.get(l.lineKey) ?? new Array(ms.length).fill(0);
            arr[i] = l.value;
            monthlyBy!.set(l.lineKey, arr);
          }
        });
      }
    }

    const sections = new Map<string, { key: string; label: string; total: number; lines: T.Line[] }>();
    for (const l of run.lines.filter((x) => x.statementId === s.id).sort((a, b) => a.sort - b.sort)) {
      const sec = sections.get(l.section) ?? { key: l.section, label: SECTION_LABELS[l.section] ?? l.section, total: 0, lines: [] };
      const line = lineOf(run, kind, l);
      if (monthlyBy) line.monthly = monthlyBy.get(l.lineKey) ?? new Array(months!.length).fill(0);
      sec.lines.push(line);
      sec.total = r2(sec.total + l.value);
      sections.set(l.section, sec);
    }
    return {
      kind,
      label: LABELS[kind],
      period: periodOf(s.periodFrom, s.periodTo),
      derived: s.derived,
      reconciled: kind === "cf" ? s.reconciled : null,
      reconDiff: kind === "cf" && !s.reconciled ? Math.abs(s.reconDiff ?? 0) : null,
      base: baseOf(run, kind),
      ...(months ? { months } : {}),
      sections: [...sections.values()],
      sample: Boolean(org?.sample),
    };
  });
}

// ---------- line detail ----------

function recommendationOf(r: typeof recommendations.$inferSelect, facts: Map<string, Map<string, FactRowLite>>): T.Recommendation {
  const c = r.components as { strength_norm: number; fit_with_in_use: number; peer_results: number; price_fit: number };
  const w = rulesFile().scoring.weights;
  return {
    rank: r.rank,
    app: appCardOf(r.appId, facts),
    match: Math.round(r.match),
    components: { strength: c.strength_norm, fit: c.fit_with_in_use, peers: c.peer_results, price: c.price_fit },
    weights: { strength: w.strength, fit: w.fit_with_in_use, peers: w.peer_results, price: w.price_fit },
    reason: r.reason,
    inUse: r.inUse,
    kind: r.kind,
  };
}

function detectedOf(d: typeof detectedApps.$inferSelect): T.DetectedApp {
  const a = app(d.appId);
  const cats = new Map(appCategories().map((c) => [c.key, c.label]));
  const cat = a?.categories.find((c) => !NOT_A_FUNCTION.has(c)) ?? a?.categories[0] ?? "other_software";
  return {
    appId: d.appId,
    name: a?.name ?? d.appId,
    category: cats.get(cat) ?? cat,
    spend12m: d.spend12m,
    monthsSeen: d.monthsSeen,
    lastPaid: d.lastPaidDate ?? (d.monthsSeen ? d.lastSeen : null), // round-2 3a: the day when we have it
    cycle: d.cycle ?? "unknown",
    state: (d.state ?? (d.present ? "active" : "inactive")) as T.Lifecycle,
  };
}

export async function lineDetail(orgId: string, lineKey: string): Promise<T.LineDetail | null> {
  const facts = await factsBy();
  const out = await withOrg(orgId, async (tx) => {
    const run = await loadRun(tx, facts);
    if (!run) return null;
    // A line key can sit on the balance sheet and the cash flow: the P&L or balance sheet flag leads.
    const f = ["pl", "bs", "cf", "trend"].map((k) => run.flags.find((x) => x.statementKind === k && x.lineKey === lineKey)).find(Boolean);
    if (!f) return null;
    const kind = f.statementKind as T.StatementKind | "trend";
    const sl = run.lines.find((l) => l.lineKey === lineKey);
    const ev = f.evidence as {
      trial_balance?: { code: string | null; name: string; ytd_net: number; as_at: string } | null;
      trend?: { label?: string; series?: { end: string; value: number | null }[] };
    };
    const name = sl?.name ?? (kind === "trend" ? (ev.trend?.label ?? lineKey) : lineKey);
    const line = lineOf(run, kind, { lineKey, code: sl?.code ?? null, name, value: sl?.value ?? f.value });
    const rule = rulesFile().rules.find((r) => r.id === f.ruleId);

    let series: { month: string; value: number }[] | undefined;
    if (ev.trend?.series) {
      series = ev.trend.series.filter((p) => p.value !== null).map((p) => ({ month: p.end, value: p.value as number })).reverse();
    } else if (kind === "pl" || kind === "bs") {
      const ms = run.stmts.filter((x) => x.kind === `${kind}_monthly`).sort((a, b) => a.periodTo.localeCompare(b.periodTo));
      if (ms.length) {
        const ml = await tx.select().from(statementLines).where(and(inArray(statementLines.statementId, ms.map((m) => m.id)), eq(statementLines.lineKey, lineKey)));
        series = ms.map((m) => ({ month: m.periodTo, value: ml.find((l) => l.statementId === m.id)?.value ?? 0 }));
      }
    }

    const det = await tx.select().from(detectedApps);
    const inArea = det.filter((d) => (rule?.app_categories ?? []).some((c) => app(d.appId)?.categories.includes(c)));
    const [r] = await tx.select({ finishedAt: syncRuns.finishedAt, startedAt: syncRuns.startedAt }).from(syncRuns).where(eq(syncRuns.id, run.runId));
    const fb = run.latestFb.get(f.id);
    const tb = ev.trial_balance;
    return {
      line,
      statementKind: kind,
      evidence: {
        trialBalance: tb ? { code: tb.code ?? "", name: tb.name, ytdNet: tb.ytd_net, asAt: tb.as_at } : null,
        statementValue: f.value,
        base: { label: kind === "bs" ? "Total assets" : "Revenue", value: f.base },
        materiality: f.materiality,
        band: f.state === "fine" ? null : f.band,
        ruleId: f.ruleId,
        ruleVersion: f.ruleVersion,
        runId: run.runId,
        refreshedAt: (r?.finishedAt ?? r?.startedAt ?? new Date()).toISOString(),
        ...(series ? { series } : {}),
      },
      cause: rule?.cause ?? null,
      detectedInArea: inArea.map(detectedOf),
      recommendations: run.recs.filter((x) => x.flagId === f.id).sort((a, b) => a.rank - b.rank).map((x) => recommendationOf(x, run.facts)),
      feedback: fb
        ? {
            id: fb.id,
            answer: (fb.answer === "no" ? "no_app_needed" : fb.answer) as T.FeedbackAnswer,
            ...(fb.subReason ? { subReason: fb.subReason } : {}),
            ...(fb.appId ? { appId: fb.appId } : {}),
            ...(fb.appName ? { appName: fb.appName } : {}),
            ...(fb.note ? { note: fb.note } : {}),
            createdAt: fb.createdAt.toISOString(),
            by: fb.userId ?? "",
          }
        : null,
    };
  });
  // Who answered: the user's email, read on the owner connection after the tenant transaction.
  if (out?.feedback?.by) {
    const [u] = await (await adminDb()).select({ email: users.email }).from(users).where(eq(users.id, out.feedback.by));
    out.feedback.by = u?.email ?? "";
  }
  return out;
}

/** The line after a feedback answer (UI-SPEC FeedbackResult.line). */
export async function lineByFlag(orgId: string, flagId: string): Promise<T.Line | null> {
  const facts = await factsBy();
  return withOrg(orgId, async (tx) => {
    const run = await loadRun(tx, facts);
    const f = run?.flags.find((x) => x.id === flagId);
    if (!run || !f) return null;
    const sl = run.lines.find((l) => l.lineKey === f.lineKey);
    return lineOf(run, f.statementKind as T.StatementKind | "trend", { lineKey: f.lineKey, code: sl?.code ?? null, name: sl?.name ?? f.lineKey, value: sl?.value ?? f.value });
  });
}

// ---------- detected apps and questions ----------

export async function detectedAppsView(orgId: string): Promise<{ apps: T.DetectedApp[]; questions: T.LifecycleQuestion[] }> {
  const rows = await withOrg(orgId, (tx) => tx.select().from(detectedApps).orderBy(desc(detectedApps.spend12m)));
  const apps = rows.filter((d) => !app(d.appId)?.categories.every((c) => NOT_A_FUNCTION.has(c))).map(detectedOf);
  return { apps, questions: questionsOf(rows) };
}

function questionsOf(rows: (typeof detectedApps.$inferSelect)[]): T.LifecycleQuestion[] {
  const out: T.LifecycleQuestion[] = [];
  for (const r of rows) {
    const ask = (r.evidence as { ask?: string | { replacing: string } }).ask;
    if (ask === "still_use") out.push({ id: `lapsing:${r.appId}`, kind: "lapsing", appId: r.appId, appName: appName(r.appId), lastPaid: r.lastSeen });
    else if (ask && typeof ask === "object")
      // "Is <new> replacing <old>?" — asked about the old app, naming the new one.
      out.push({ id: `replacement:${r.appId}`, kind: "replacement", appId: ask.replacing, appName: appName(ask.replacing), lastPaid: null, replacementAppId: r.appId, replacementAppName: appName(r.appId) });
  }
  return out;
}

// ---------- summary ----------

export async function summary(orgId: string): Promise<T.Summary | null> {
  const sub = await subscriptionOf(orgId);
  const facts = await factsBy();
  return withOrg(orgId, async (tx) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
    if (!org) return null;
    const [lastRun] = await tx.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1);
    const [conn] = await tx.select({ status: xeroConnections.status }).from(xeroConnections).where(eq(xeroConnections.orgId, orgId)).limit(1);
    const run = await loadRun(tx, facts);
    const banners = bannersOf({ org, lastRun, conn, run, sub });
    const det = await tx.select().from(detectedApps);
    const questions = questionsOf(det);
    const base = {
      lastRefreshAt: iso(lastRun?.finishedAt ?? null),
      refreshing: lastRun?.status === "running",
      sample: org.sample,
      banners,
      questions,
    };
    if (!run || !run.pl) {
      return { period: { label: "Waiting for the first refresh", from: null, to: new Date().toISOString().slice(0, 10) }, atStake: 0, atStakeLabel: AT_STAKE_LABEL, flaggedLines: 0, totalLines: 0, appsInUse: 0, appsMatched: 0, shortlistMonthly: null, shortlistUnknownPrices: 0, biggestLines: [], trends: [], ...base };
    }
    const catOf = new Map(run.lines.map((l) => [l.lineKey, l.category]));
    const revenueCats = new Set(accountCategories().filter((c) => c.revenue).map((c) => c.key));
    const stake = atStakeOf(run.flags.map((f) => ({ kind: f.statementKind, state: f.state, value: f.value, lineKey: f.lineKey })), (k) => catOf.get(k) ?? null, revenueCats);
    const flagged = run.flags.filter((f) => f.state === "flagged" && f.statementKind !== "trend");
    const nameOf = (f: (typeof run.flags)[number]) => run.lines.find((l) => l.lineKey === f.lineKey && run.stmts.find((s) => s.id === l.statementId)?.kind === f.statementKind);
    const biggest = flagged
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 5)
      .map((f) => {
        const sl = nameOf(f);
        return lineOf(run, f.statementKind as T.StatementKind, { lineKey: f.lineKey, code: sl?.code ?? null, name: sl?.name ?? f.lineKey, value: sl?.value ?? f.value });
      });
    const sl = await tx.select().from(shortlist);
    const prices = sl.map((s) => priceOf(facts.get(s.appId)));
    const monthly = prices.filter((p) => p.value?.fromGbp != null && p.value.model === "per_month").map((p) => p.value!.fromGbp!);
    const trends = await trendsView(tx, run);
    return {
      period: periodOf(run.pl.periodFrom, run.pl.periodTo),
      atStake: stake,
      atStakeLabel: AT_STAKE_LABEL,
      flaggedLines: new Set(flagged.map((f) => flagKey(f.statementKind, f.lineKey))).size,
      totalLines: run.flags.filter((f) => f.statementKind !== "trend").length,
      appsInUse: det.filter((d) => d.present && !app(d.appId)?.categories.every((c) => NOT_A_FUNCTION.has(c))).length,
      appsMatched: new Set(run.recs.filter((r) => !r.inUse).map((r) => r.appId)).size,
      shortlistMonthly: monthly.length ? r2(monthly.reduce((a, b) => a + b, 0)) : null,
      shortlistUnknownPrices: prices.length - monthly.length,
      biggestLines: biggest,
      trends,
      ...base,
    };
  });
}

const AT_STAKE_LABEL = "of this year's costs run through lines with no app behind them";

const TREND_LABELS: Record<T.TrendSignal["key"], { label: string; unit: "days" | "months" }> = {
  debtor_days: { label: "Debtor days", unit: "days" },
  creditor_days: { label: "Creditor days", unit: "days" },
  stock_days: { label: "Stock days", unit: "days" },
  cash_headroom_months: { label: "Cash headroom", unit: "months" },
};

async function trendsView(tx: Db, run: NonNullable<Run>): Promise<T.TrendSignal[]> {
  const info = await accountInfo(tx);
  const { months } = await trendMonths(tx, run.stmts, info);
  const rules = rulesFile().trends;
  return trendsOf(months)
    .filter((t) => t.latest !== null)
    .map((t) => {
      const lk = `trend:${t.key}`;
      const f = run.flags.find((x) => x.statementKind === "trend" && x.lineKey === lk);
      const flagged = f?.state === "flagged";
      return {
        key: t.key,
        ...TREND_LABELS[t.key],
        series: t.series.filter((p) => p.value !== null).map((p) => ({ month: p.end, value: p.value as number })).reverse(),
        latest: t.latest!,
        change3m: t.change ?? 0,
        threshold: rules[t.key]?.threshold ?? 0,
        flagged,
        atStake: f ? f.value : null,
        band: flagged ? f!.band : null,
        flagId: f?.id ?? null,
        lineKey: f ? lk : null,
      };
    });
}

function bannersOf(x: {
  org: typeof orgs.$inferSelect;
  lastRun: typeof syncRuns.$inferSelect | undefined;
  conn: { status: string } | undefined;
  run: Run;
  sub: T.Subscription;
}): T.Banner[] {
  const out: T.Banner[] = [];
  if (x.org.sample) out.push({ kind: "sample", message: "Sample data: not a real business." });
  if (x.conn?.status === "revoked") out.push({ kind: "connection_revoked", message: `Xero is disconnected for ${x.org.name}.`, action: { label: "Reconnect", href: "/connect" } });
  if (x.lastRun?.status === "error") {
    const when = (x.lastRun.finishedAt ?? x.lastRun.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
    out.push({ kind: "refresh_failed", message: `Last update from Xero failed ${when}.`, action: { label: "Try again", href: `/app/${x.org.id}?refresh=1` } });
  }
  if (x.run?.cf && !x.run.cf.reconciled) {
    out.push({ kind: "cashflow_unreconciled", message: `Cash flow doesn't reconcile yet: £${Math.abs(x.run.cf.reconDiff ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} unexplained. We're checking.` });
  }
  if (x.sub.status === "past_due") out.push({ kind: "payment_failed", message: "Your last payment failed.", action: { label: "Update card", href: `/app/${x.org.id}/billing` } });
  return out;
}

// ---------- refresh run ----------

const STEP_LABELS: Record<string, string> = {
  organisation: "Business details",
  accounts: "Chart of accounts",
  reports: "Profit and loss, balance sheet (12 months) and trial balance",
  mapping: "Matching your accounts",
  statements: "Building your statements",
  apps: "Supplier spend",
  cashflow: "Cash flow",
  flags: "Checking lines",
};

export async function refreshRun(orgId: string, runId: string): Promise<T.RefreshRun | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const [r] = await withOrg(orgId, (tx) => tx.select().from(syncRuns).where(eq(syncRuns.id, runId)));
  return r ? runOf(r) : null;
}

export function runOf(r: typeof syncRuns.$inferSelect): T.RefreshRun {
  const steps = (r.steps ?? []) as { key: string; status: string }[];
  const out: T.RefreshRun = {
    id: r.id,
    status: r.status as T.RefreshRun["status"],
    startedAt: r.startedAt.toISOString(),
    finishedAt: iso(r.finishedAt),
    steps: steps.map((s) => ({
      key: s.key,
      label: STEP_LABELS[s.key] ?? s.key,
      status: s.status === "ok" ? "done" : s.status === "error" ? "error" : s.status === "running" ? "running" : "pending",
    })),
  };
  // The stored error is for our logs (it is already free of ledger values); the user gets plain words.
  if (r.status === "error") out.error = { code: "XERO_UNAVAILABLE", message: "The update from Xero didn't finish. Try again in a few minutes.", retryable: true, requestId: r.id.slice(0, 13) };
  return out;
}

// ---------- me ----------

export async function me(userId: string, activeOrgId: string | null): Promise<T.Me | null> {
  const db = await adminDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) return null;
  const { myOrgs } = await import("@/lib/me");
  const list = await myOrgs(userId);
  const ids = list.map((o) => o.id);
  const meta = ids.length ? await db.select().from(orgs).where(inArray(orgs.id, ids)) : [];
  const conns = ids.length ? await db.select({ orgId: xeroConnections.orgId, status: xeroConnections.status }).from(xeroConnections).where(inArray(xeroConnections.orgId, ids)) : [];
  return {
    user: { id: u.id, email: u.email, name: u.name ?? "", jobTitle: u.jobTitle, isAdmin: u.isAdmin },
    orgs: list.map((o) => {
      const m = meta.find((x) => x.id === o.id);
      const c = conns.find((x) => x.orgId === o.id);
      return {
        id: o.id,
        name: o.name,
        industry: industryOf(m?.industry ?? null),
        markets: marketsOf(m?.markets ?? []),
        lastRefreshAt: iso(o.lastRefresh?.finishedAt ?? null),
        atStake: o.atStake,
        connection: o.sample ? "active" : !c ? "error" : c.status === "revoked" ? "revoked" : c.status === "active" ? "active" : "error",
        sample: o.sample,
      };
    }),
    activeOrgId: activeOrgId && ids.includes(activeOrgId) ? activeOrgId : (ids[0] ?? null),
  };
}

// ---------- settings ----------

export async function settingsOf(orgId: string): Promise<T.OrgSettings | null> {
  const [o] = await withOrg(orgId, (tx) => tx.select().from(orgs).where(eq(orgs.id, orgId)));
  if (!o) return null;
  return {
    markets: marketsOf(o.markets),
    industry: industryOf(o.industry),
    includeCurrentMonth: o.includeCurrentMonth,
    // Price-sharing consent (orgs.share_prices). Peer price ranges stay OPEN (CHANGES-v1.1 §4 item 2): nothing shows yet.
    benchmarkOptIn: o.sharePrices,
    // TODO(owner): the monthly email is not specified in BACKEND.md yet (NOTES.md "UI-SPEC vs backend"). Always off.
    digestOptIn: false,
  };
}

// ---------- essentials ----------

export async function essentialsOf(orgId: string): Promise<T.Essential[]> {
  return withOrg(orgId, async (tx) => {
    const [o] = await tx.select({ markets: orgs.markets }).from(orgs).where(eq(orgs.id, orgId));
    const covered = new Map((await tx.select().from(orgEssentials)).map((r) => [r.key, r.covered]));
    const monthEnd = catalogApps().find((a) => a.categories.includes("month_end"));
    return catalogEssentials()
      .filter((e) => (o?.markets ?? ["UK"]).includes(e.market))
      .map((e) => ({
        key: e.key,
        name: e.label,
        frequency: e.cadence,
        nextDue: null, // we don't know filing dates yet; never guessed
        suggested: { appId: e.key.endsWith("month_end_close") ? (monthEnd?.id ?? null) : null, label: e.note ?? "" },
        covered: covered.get(e.key) ?? false,
      }));
  });
}

export async function setEssential(orgId: string, key: string, covered: boolean): Promise<T.Essential[]> {
  if (!catalogEssentials().some((e) => e.key === key)) {
    const { HttpError } = await import("@/lib/api");
    throw new HttpError(404, "Unknown item");
  }
  await withOrg(orgId, (tx) =>
    tx.insert(orgEssentials).values({ orgId, key, covered }).onConflictDoUpdate({ target: [orgEssentials.orgId, orgEssentials.key], set: { covered, updatedAt: new Date() } }),
  );
  return essentialsOf(orgId);
}

// ---------- shortlist ----------

export async function shortlistOf(orgId: string): Promise<T.ShortlistItem[]> {
  const rows = await withOrg(orgId, (tx) => tx.select().from(shortlist).orderBy(shortlist.createdAt));
  return shortlistItems(orgId, rows.map((r) => ({ appId: r.appId, lineKey: r.lineKey, addedAt: r.createdAt })));
}

/** Shortlist rows (the org's, or a /demo guest's) in the UI-SPEC shape, with line names and verified prices. */
export async function shortlistItems(orgId: string, rows: { appId: string; lineKey: string; addedAt: Date }[]): Promise<T.ShortlistItem[]> {
  const facts = await factsBy();
  const run = await withOrg(orgId, (tx) => loadRun(tx, facts));
  return rows.map((r) => ({
    appId: r.appId,
    appName: appName(r.appId),
    lineKey: r.lineKey || null,
    lineName: r.lineKey ? (run?.lines.find((l) => l.lineKey === r.lineKey)?.name ?? null) : null,
    price: priceOf(facts.get(r.appId)),
    addedAt: r.addedAt.toISOString(),
  }));
}

export async function addToShortlist(orgId: string, userId: string | null, appId: string, lineKey?: string | null) {
  if (!app(appId)) {
    const { HttpError } = await import("@/lib/api");
    throw new HttpError(404, "Unknown app");
  }
  await withOrg(orgId, (tx) => tx.insert(shortlist).values({ orgId, appId, lineKey: lineKey ?? "", addedBy: userId }).onConflictDoNothing());
  return shortlistOf(orgId);
}

export async function removeFromShortlist(orgId: string, appId: string, lineKey?: string | null) {
  await withOrg(orgId, (tx) =>
    tx.delete(shortlist).where(lineKey === undefined ? eq(shortlist.appId, appId) : and(eq(shortlist.appId, appId), eq(shortlist.lineKey, lineKey ?? ""))),
  );
  return shortlistOf(orgId);
}

// ---------- billing ----------

/**
 * UI-SPEC plan cards from catalog/plans.yaml. TODO(owner, NOTES.md "UI-SPEC vs backend" item 1): the spec's
 * "annual includes the audit" and "audit only" aren't decided; until then annual doesn't include it and audit
 * only is unavailable (hidden). Prices are OPEN, so every price is null.
 */
export function plansView(): T.Plan[] {
  const p = planCatalog();
  const audit = p.one_off.find((o) => o.key === "audit");
  const byKey = new Map(p.plans.map((x) => [x.key, x]));
  const m = byKey.get("pro_monthly");
  const a = byKey.get("pro_annual");
  // Round-2 3e: monthly + one-off audit, annual with the audit included, audit only. Prices from plans.yaml only.
  return [
    { id: "monthly", label: m?.label ?? "Monthly", priceGbp: m?.price_gbp ?? null, interval: "month", auditIncluded: m?.audit === "included", auditPriceGbp: audit?.price_gbp ?? null, available: Boolean(m), highlight: false },
    { id: "annual", label: a?.label ?? "Annual", priceGbp: a?.price_gbp ?? null, interval: "year", auditIncluded: a?.audit === "included", auditPriceGbp: audit?.price_gbp ?? null, available: Boolean(a), highlight: Boolean(a) },
    { id: "audit_only", label: audit?.label ?? "Audit only", priceGbp: audit?.price_gbp ?? null, interval: "one_off", auditIncluded: true, auditPriceGbp: audit?.price_gbp ?? null, available: Boolean(audit?.sold_alone), highlight: false },
  ];
}

/** Contract plan id → plans.yaml key. */
export const PLAN_KEYS: Record<string, string> = { monthly: "pro_monthly", annual: "pro_annual", audit_only: "audit" };

export async function subscriptionOf(orgId: string): Promise<T.Subscription> {
  const db = await adminDb();
  // NEXT-STEPS P0.5: testers are design partners: free, full access, no Stripe objects.
  const [o] = await db.select({ dp: orgs.designPartner }).from(orgs).where(eq(orgs.id, orgId));
  if (o?.dp) return { status: "design_partner", planId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };
  const [s] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).orderBy(desc(subscriptions.updatedAt)).limit(1);
  if (!s) return { status: "none", planId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };
  const planId = (Object.entries(PLAN_KEYS).find(([, v]) => v === s.plan)?.[0] ?? null) as T.Plan["id"] | null;
  const status: T.Subscription["status"] =
    s.status === "active" || s.status === "trialing" ? "active" : s.status === "past_due" || s.status === "unpaid" ? "past_due" : s.status === "design_partner" ? "design_partner" : s.status === "canceled" ? "cancelled" : "none";
  return { status, planId, currentPeriodEnd: s.currentPeriodEnd ? s.currentPeriodEnd.toISOString().slice(0, 10) : null, cancelAtPeriodEnd: false };
}

/** `Me` for a /demo guest: no account, one sample business (NEXT-STEPS P0.2). */
export async function guestMe(guestId: string, orgId: string): Promise<T.Me> {
  const [o] = await withOrg(orgId, (tx) => tx.select().from(orgs).where(eq(orgs.id, orgId)));
  const s = await summary(orgId);
  return {
    user: { id: guestId, email: "", name: "Demo guest", jobTitle: null, isAdmin: false },
    orgs: o
      ? [{ id: o.id, name: o.name, industry: industryOf(o.industry), markets: marketsOf(o.markets), lastRefreshAt: s?.lastRefreshAt ?? null, atStake: s?.atStake ?? null, connection: "active", sample: o.sample }]
      : [],
    activeOrgId: o ? o.id : null,
  };
}
