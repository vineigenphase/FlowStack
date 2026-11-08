/**
 * Ask (CLAUDE.md §7.4): a plain-English question answered against this business's own stack.
 *
 * 1. Retrieve candidates from the catalogue by keyword + finance-job match (no ledger embeddings, no vector index).
 * 2. Rules answer always: matching apps, ranked by job match, fit with apps they keep and whether that job needs a look.
 * 3. Written answer only when LLM_ENABLED and the business opted in (orgs.ask_ai; Xero terms 7(b)(ii)). The prompt gets
 *    derived features only: industry, size band, markets, detected app names, which jobs need a look. Never amounts,
 *    transactions, contact names or account names (BACKEND.md D9, §17). Every point must cite an allowed source id;
 *    points citing anything else are dropped. Prices only as published facts we pass in, never invented.
 * Inference only, per request; nothing is stored or used for training (§2.2).
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { appFacts, detectedApps, orgs, statements } from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { appCategories, apps as catalogApps, type App } from "@/lib/catalog/load";
import { edgeKind } from "@/lib/rank/score";
import { stackMapView } from "@/lib/read/views";
import { industryLabel } from "@/lib/orgs/settings";
import { sizeBand, SIZE_BANDS } from "@/lib/prices";
import { supportScores } from "@/lib/reviews";

/** Words people use for each finance job. Lower-case; matched as whole words or phrases. */
export const JOB_WORDS: Record<string, string[]> = {
  payroll: ["payroll", "payslip", "payslips", "pay run", "salaries", "salary", "wages", "tronc", "paye", "pension", "pensions", "auto-enrolment", "hr"],
  rota: ["rota", "rotas", "shift", "shifts", "scheduling", "schedule", "timesheet", "timesheets", "clock in", "time and attendance"],
  inventory: ["stock", "inventory", "purchasing", "purchase orders", "recipes", "recipe", "cogs", "cost of sales", "wastage", "warehouse", "suppliers ordering"],
  data_capture: ["receipts", "receipt", "bill capture", "data entry", "ocr", "scan", "scanning", "bills", "invoices in", "supplier invoices"],
  spend_payables: ["expenses", "expense", "cards", "card", "spend", "approvals", "payables", "accounts payable", "ap", "pay suppliers", "bill pay"],
  billing_receivables: ["invoicing", "invoices", "receivables", "debtors", "chasing", "credit control", "collections", "accounts receivable", "ar", "late payers", "direct debit"],
  management_reporting: ["reporting", "reports", "dashboard", "dashboards", "kpi", "kpis", "board pack", "management accounts"],
  consolidation: ["consolidation", "consolidate", "group", "multi-entity", "intercompany", "multiple companies", "entities"],
  fx_banking: ["fx", "currency", "currencies", "foreign exchange", "international payments", "multi-currency", "banking", "bank account"],
  job_project: ["jobs", "job costing", "projects", "project", "quotes", "quoting", "field service", "engineers", "trades"],
  fpa: ["budget", "budgets", "budgeting", "fp&a", "planning", "scenario", "scenarios", "forecast", "forecasting"],
  cash_forecasting: ["cash flow forecast", "cashflow forecast", "cash forecast", "runway", "cash position", "13-week"],
  epos_ecommerce: ["epos", "till", "tills", "point of sale", "pos", "shopify", "ecommerce", "e-commerce", "amazon", "online shop", "card machine"],
  compliance: ["vat", "mtd", "making tax digital", "tax", "sales tax", "compliance", "audit"],
};

const OFF = new Set(["accounting", "other_software"]);
const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9&+\- ]/g, " ").replace(/\s+/g, " ")} `;
const jobLabel = (k: string) => appCategories().find((c) => c.key === k)?.label ?? k;

export type Candidate = { app: App; score: number; reasons: string[]; sources: string[] };
export type Retrieval = { jobs: string[]; named: string[]; candidates: Candidate[] };

/** Pure: which jobs and apps the question is about, and the best catalogue candidates for this business. */
export function retrieve(
  question: string,
  ctx: { markets: string[]; inUse: string[]; needsLook: string[]; catalog: App[]; limit?: number },
): Retrieval {
  const q = norm(question);
  const jobs = Object.entries(JOB_WORDS)
    .map(([job, words]) => [job, words.filter((w) => q.includes(` ${w} `)).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([job]) => job);
  const named = ctx.catalog.filter((a) => q.includes(norm(a.name)) || q.includes(` ${a.id} `)).map((a) => a.id);
  // A named app with no job words: look in its jobs.
  if (!jobs.length) for (const id of named) for (const c of ctx.catalog.find((a) => a.id === id)!.categories) if (!OFF.has(c) && !jobs.includes(c)) jobs.push(c);
  const kept = ctx.catalog.filter((a) => ctx.inUse.includes(a.id) && !a.categories.some((c) => OFF.has(c)));

  const candidates = ctx.catalog
    .filter((a) => !a.categories.every((c) => OFF.has(c)))
    .filter((a) => a.markets.some((m) => ctx.markets.includes(m)) || named.includes(a.id))
    .map((a): Candidate => {
      const reasons: string[] = [];
      const sources: string[] = [`app:${a.id}`];
      let score = 0;
      const hit = jobs.filter((j) => a.categories.includes(j));
      if (hit.length) {
        score += 3 * hit.length;
        reasons.push(`Does ${hit.map(jobLabel).join(" and ").toLowerCase()}`);
      }
      if (named.includes(a.id)) score += 4;
      if (ctx.inUse.includes(a.id)) {
        score += 1;
        reasons.push("You already pay for it");
        sources.push(`stack:${a.id}`);
      }
      const links = kept.filter((k) => k.id !== a.id).map((k) => [k, edgeKind(a, k)] as const).filter(([, e]) => e);
      if (links.length) {
        score += links.some(([, e]) => e === "native") ? 1.5 : 1;
        reasons.push(`Works with ${links.map(([k]) => k.name).join(", ")}, which you use`);
        for (const [k] of links) sources.push(`stack:${k.id}`);
      }
      const look = hit.filter((j) => ctx.needsLook.includes(j));
      if (look.length) {
        score += 1;
        reasons.push(`Your figures say ${look.map(jobLabel).join(" and ").toLowerCase()} needs a look`);
        for (const j of look) sources.push(`signal:${j}`);
      }
      return { app: a, score, reasons, sources };
    })
    .filter((c) => c.score >= 3 || named.includes(c.app.id))
    .sort((x, y) => y.score - x.score || x.app.name.localeCompare(y.app.name))
    .slice(0, ctx.limit ?? 5);
  return { jobs, named, candidates };
}

/** Derived features only: what the prompt may contain about this business. No amounts, no names of people or contacts. */
export async function features(orgId: string) {
  const { org, det, pl } = await withOrg(orgId, async (tx) => ({
    org: (await tx.select().from(orgs).where(eq(orgs.id, orgId)))[0],
    det: await tx.select({ appId: detectedApps.appId, present: detectedApps.present }).from(detectedApps),
    pl: (await tx.select().from(statements).where(eq(statements.kind, "pl"))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
  }));
  const map = await stackMapView(orgId);
  const band = pl ? sizeBand(pl.totals.revenue ?? 0, pl.periodFrom, pl.periodTo) : null;
  return {
    askAi: Boolean(org?.askAi),
    markets: org?.markets ?? ["UK"],
    industry: industryLabel(org?.industry ?? null),
    sizeBand: band ? SIZE_BANDS.find((b) => b.key === band)!.label : null,
    inUse: det.filter((d) => d.present).map((d) => d.appId),
    needsLook: (map?.functions ?? []).filter((f) => f.status === "gap" || f.status === "part_manual").map((f) => f.key),
  };
}

export const AskOut = z.object({
  answer: z.string(),
  points: z.array(z.object({ text: z.string(), cites: z.array(z.string()) })),
  refused_prices: z.boolean(),
});

export type AskResult = {
  mode: "rules" | "written";
  why: string | null;
  jobs: { key: string; label: string }[];
  candidates: { id: string; name: string; reasons: string[]; price: string | null; support: string | null }[];
  answer: string | null;
  points: { text: string; cites: string[] }[];
};

const SYSTEM = `You help a finance director choose software that works with Xero.
Answer only from the facts given: the business summary, the candidate apps and their published facts.
Rules:
- Every point must cite one or more source ids from the list given, exactly as written (e.g. app:dext, signal:payroll, stack:deputy).
- Never state or estimate a price unless it is in a candidate's published facts; if asked about price and none is given, say it isn't published.
- No sales language. Plain British English. Short: an answer of at most three sentences, then at most five points.
- If none of the candidates fit, say so.`;

/** Builds the prompt and the set of source ids a point may cite. Exported so tests can check what leaves us. */
export function askPrompt(
  question: string,
  f: { industry: string | null; sizeBand: string | null; markets: string[]; inUse: string[]; needsLook: string[] },
  r: Retrieval,
  priceOf: (id: string) => string | null,
  supportOf: (id: string) => string | null,
) {
  const allowed = new Set(r.candidates.flatMap((c) => c.sources));
  for (const j of f.needsLook) allowed.add(`signal:${j}`);
  for (const a of f.inUse) allowed.add(`stack:${a}`);
  const appNames = (xs: string[]) => xs.map((x) => catalogApps().find((a) => a.id === x)?.name ?? x);
  const prompt = [
    `Question: ${question.slice(0, 500)}`,
    "",
    "Business summary (derived from their Xero; no amounts):",
    `- Industry: ${f.industry ?? "not set"}; size: ${f.sizeBand ?? "unknown"}; markets: ${f.markets.join(", ")}`,
    `- Apps they pay for: ${f.inUse.map((a) => `${appNames([a])[0]} [stack:${a}]`).join(", ") || "none detected"}`,
    `- Finance jobs their figures say need a look: ${f.needsLook.map((j) => `${jobLabel(j)} [signal:${j}]`).join(", ") || "none"}`,
    "",
    "Candidate apps:",
    ...r.candidates.map(
      (c) =>
        `- ${c.app.name} [app:${c.app.id}]: jobs ${c.app.categories.filter((x) => !OFF.has(x)).map(jobLabel).join(", ")}; ${c.reasons.join("; ") || "matches the question"}; ` +
        `published price: ${priceOf(c.app.id) ?? "not published"}; ${supportOf(c.app.id) ?? "too few verified reviews to judge support"}`,
    ),
    "",
    `Allowed source ids: ${[...allowed].join(", ")}`,
  ].join("\n");

  return { prompt, allowed };
}

/** Answer a question for one business. Rules always; written answer only with consent and the LLM switched on. */
export async function ask(orgId: string, question: string): Promise<AskResult> {
  const f = await features(orgId);
  const r = retrieve(question, { markets: f.markets, inUse: f.inUse, needsLook: f.needsLook, catalog: catalogApps() });
  const ids = r.candidates.map((c) => c.app.id);
  const db = await adminDb();
  const facts = ids.length ? (await db.select().from(appFacts).where(eq(appFacts.field, "price_from_gbp"))).filter((x) => ids.includes(x.appId) && (x.state === "verified" || x.state === "found") && typeof x.value === "number") : [];
  const support = await supportScores(ids);
  const priceOf = (id: string) => {
    const v = facts.find((x) => x.appId === id)?.value as number | undefined;
    return v === undefined ? null : v === 0 ? "Free plan" : `From £${v} a month (vendor's site)`;
  };
  const supportOf = (id: string) => {
    const s = support.get(id);
    return s && s.n >= 3 ? `Support after go-live ${s.avg}/5 (${s.n} verified reviews)` : null;
  };
  const base: AskResult = {
    mode: "rules",
    why: null,
    jobs: r.jobs.map((k) => ({ key: k, label: jobLabel(k) })),
    candidates: r.candidates.map((c) => ({ id: c.app.id, name: c.app.name, reasons: c.reasons, price: priceOf(c.app.id), support: supportOf(c.app.id) })),
    answer: null,
    points: [],
  };

  if (!env().LLM_ENABLED || !env().ANTHROPIC_API_KEY) return { ...base, why: "Written answers aren't switched on." };
  if (!f.askAi) return { ...base, why: "Written answers are off for this business. Turn them on in Settings." };
  if (!r.candidates.length) return { ...base, why: "No apps in our catalogue match that question." };

  const { prompt, allowed } = askPrompt(question, f, r, priceOf, supportOf);

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const client = new Anthropic();
    const res = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(AskOut) },
      messages: [{ role: "user", content: prompt }],
    });
    // Log sizes only: never the question, the prompt or the answer.
    log.info({ orgId, candidates: ids.length, in: res.usage?.input_tokens, out: res.usage?.output_tokens }, "ask");
    if (res.stop_reason === "refusal" || !res.parsed_output) return { ...base, why: "No written answer this time." };
    const out = res.parsed_output;
    const points = out.points.filter((p) => p.cites.length && p.cites.every((c) => allowed.has(c)));
    return { ...base, mode: "written", answer: out.answer, points };
  } catch (e) {
    log.error({ err: { message: (e as Error).message }, orgId }, "ask failed");
    return { ...base, why: "The written answer isn't available right now." };
  }
}

/** Ask across all of a firm's clients: rules only (one AI call per client would send many summaries at once). */
export async function askAcross(orgIds: { orgId: string; name: string }[], question: string) {
  const out: { orgId: string; name: string; top: { id: string; name: string; reasons: string[] }[]; needsLook: boolean }[] = [];
  let jobs: string[] = [];
  for (const o of orgIds) {
    const f = await features(o.orgId);
    const r = retrieve(question, { markets: f.markets, inUse: f.inUse, needsLook: f.needsLook, catalog: catalogApps(), limit: 3 });
    jobs = r.jobs;
    out.push({
      orgId: o.orgId,
      name: o.name,
      top: r.candidates.map((c) => ({ id: c.app.id, name: c.app.name, reasons: c.reasons })),
      needsLook: r.jobs.some((j) => f.needsLook.includes(j)),
    });
  }
  return { jobs: jobs.map((k) => ({ key: k, label: jobLabel(k) })), clients: out.sort((a, b) => Number(b.needsLook) - Number(a.needsLook) || a.name.localeCompare(b.name)) };
}
