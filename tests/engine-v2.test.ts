/**
 * ENGINE-V2 Phase 1: inputs, scoring, trace, shadow mode. Pure tests use hand-made apps; the last block runs a real
 * refresh on fixtures/xero/demo-uk-synthetic (SAMPLE data) against in-memory Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { rulesFile, type App, type Rule, type ScoringV2 } from "@/lib/catalog/load";
import type { XeroAppListing } from "@/lib/appdb/schema";
import type { V2App } from "@/lib/rank/v2/apps";
import { v2Apps } from "@/lib/rank/v2/apps";
import { awardBoost } from "@/lib/rank/v2/awards";
import { bm25, keywordMatch } from "@/lib/rank/v2/keyword-match";
import { functionMatch } from "@/lib/rank/v2/function-match";
import { integrationFit } from "@/lib/rank/v2/integration-fit";
import { priceScore } from "@/lib/rank/v2/price";
import { ratingScore } from "@/lib/rank/v2/rating";
import { volumeScore } from "@/lib/rank/v2/volume";
import { rankLine, type LineV2 } from "@/lib/rank/v2/score";
import { rankFlagsV2 } from "@/lib/rank/v2/run";
import { v2Trace, withOverrides } from "@/lib/rank/v2/trace";
import type { FlagOut } from "@/lib/signals/compute";

const S = rulesFile().scoring_v2!;
const rule = (id: string) => rulesFile().rules.find((r) => r.id === id)!;

const listing = (p: Partial<XeroAppListing>): XeroAppListing => ({
  listing_id: "xa-x", name: "X", website: null, xero_categories: [], xero_functions: [], description: null,
  rating_avg: null, rating_count: null, review_count: null, pricing_tiers: [], awards: [], markets: ["UK"],
  source_url: null, captured_at: "2026-11-18", ...p,
});
const app = (id: string, p: Partial<V2App> = {}, l: Partial<XeroAppListing> | null = {}): V2App => {
  const li = l === null ? null : listing({ listing_id: `xa-${id}`, name: id, ...l });
  return { id, name: id, curated: null, categories: ["billing_receivables"], markets: ["UK"], listing: li, functions: li?.xero_functions ?? [], ...p };
};
const line: LineV2 = { lineKey: "bs:trade_debtors", name: "Trade debtors", value: 50_000, materiality: 0.2, band: "high", ruleId: "receivables", ruleVersion: 1, state: "flagged", strengthNorm: 1 };
const ctx = (pool: V2App[], over: Partial<Parameters<typeof rankLine>[2]> = {}) => ({
  pool, kept: [] as App[], inUse: new Set<string>(), markets: ["UK"], annualRevenue: 1_000_000, headcount: null, year: 2026, scoring: S, ...over,
});

describe("inputs: missing data scores neutral and says so", () => {
  it("no listing → function, rating, volume and price are 0.5 and missing; awards are 0, not missing", () => {
    const a = app("bare", {}, null);
    for (const i of [functionMatch(a, rule("receivables"), S), ratingScore(a, 4.5, S), volumeScore(a, 100, S), priceScore(a, 1e6, null, S)]) {
      expect(i).toMatchObject({ normalised: 0.5, missing: true });
    }
    expect(awardBoost(a, ["UK"], 2026, S)).toMatchObject({ normalised: 0, missing: false });
  });

  it("a directory app with no integrations entered scores 'no known integration' (0.3), the same as a catalogue app with no edge", () => {
    const kept = [{ id: "dext", name: "Dext", categories: ["data_capture"], markets: ["UK"], integrations: [] } as unknown as App];
    expect(integrationFit(app("dir"), kept, S)).toMatchObject({ normalised: S.integration_fit.none, missing: false });
    const curated = { id: "cur", name: "Cur", categories: ["billing_receivables"], markets: ["UK"], integrations: [] } as unknown as App;
    expect(integrationFit(app("cur", { curated }), kept, S).normalised).toBe(integrationFit(app("dir"), kept, S).normalised);
    expect(integrationFit(app("dir"), [], S)).toMatchObject({ normalised: S.integration_fit.no_apps, missing: false });
  });

  it("0 reviews is a known zero for volume, and no rating (missing) for rating", () => {
    const a = app("new", {}, { review_count: 0, rating_avg: null });
    expect(volumeScore(a, 300, S)).toMatchObject({ normalised: 0, missing: false });
    expect(ratingScore(a, 4.5, S)).toMatchObject({ normalised: 0.5, missing: true });
  });
});

describe("inputs: the formulas", () => {
  it("Bayesian prior: 5.0 from 2 reviews scores below 4.6 from 400", () => {
    const few = ratingScore(app("few", {}, { rating_avg: 5, review_count: 2 }), 4.2, S);
    const many = ratingScore(app("many", {}, { rating_avg: 4.6, review_count: 400 }), 4.2, S);
    expect(few.normalised).toBeLessThan(many.normalised);
  });

  it("award decay: a winner counts 0.10 this year, 0.05 a year later; finalist half that; other regions don't count; capped", () => {
    const w = (year: number, level: "winner" | "finalist", region = "global") => app("a", {}, { awards: [{ name: "Xero Awards", year, region, level }] });
    expect(awardBoost(w(2026, "winner"), ["UK"], 2026, S).normalised).toBeCloseTo(0.1);
    expect(awardBoost(w(2025, "winner"), ["UK"], 2026, S).normalised).toBeCloseTo(0.05);
    expect(awardBoost(w(2026, "finalist"), ["UK"], 2026, S).normalised).toBeCloseTo(0.05);
    expect(awardBoost(w(2026, "winner", "ANZ"), ["UK"], 2026, S).normalised).toBe(0);
    const many = app("m", {}, { awards: [2026, 2026, 2026].map((y) => ({ name: "Xero Awards", year: y, region: "UK", level: "winner" as const })) });
    expect(awardBoost(many, ["UK"], 2026, S).normalised).toBe(S.award_boost.cap);
  });

  it("price per unit type: per business costs directly; per user needs headcount; usage can't be costed; quote is missing", () => {
    const t = (unit: "org" | "user" | "transaction", price: number | null) => app("p", {}, { pricing_tiers: [{ name: "Plan", price_gbp: price, period: "month", unit }] });
    // £100/month = £1,200/yr = 0.12% of £1m → 1 (≤ 0.2%)
    expect(priceScore(t("org", 100), 1e6, null, S)).toMatchObject({ normalised: 1, missing: false });
    // £1,000/month = 1.2% of £1m → between good (0.2%) and bad (2%)
    expect(priceScore(t("org", 1000), 1e6, null, S).normalised).toBeCloseTo(1 - (0.012 - 0.002) / (0.02 - 0.002), 5);
    expect(priceScore(t("user", 10), 1e6, null, S).missing).toBe(true);
    // £10 × 12 months × 50 people = £6,000/yr = 0.6% of £1m
    expect(priceScore(t("user", 10), 1e6, 50, S).normalised).toBeCloseTo(1 - (0.006 - 0.002) / (0.02 - 0.002), 5);
    expect(priceScore(t("transaction", 1), 1e6, null, S).missing).toBe(true);
    expect(priceScore(t("org", null), 1e6, null, S)).toMatchObject({ missing: true, note: "Price on request" });
  });

  it("function match: required share + half the helpful share, capped at 1", () => {
    const r = rule("receivables"); // required [Invoices, Payments], helpful [Contacts, Credit Notes, Overpayments]
    const a = app("f", { functions: ["Invoices", "Contacts"] });
    expect(functionMatch(a, r, S).normalised).toBeCloseTo(0.5 + 0.5 * (1 / 3), 5);
    expect(functionMatch(app("g", { functions: ["Invoices", "Payments", "Contacts", "Credit Notes", "Overpayments"] }), r, S).normalised).toBe(1);
  });

  it("keyword match: BM25 scaled by the best description in the set; the matched words are kept", () => {
    const m = keywordMatch(["chase", "overdue", "debtors"], new Map([["a", "Chase overdue invoices and debtors automatically."], ["b", "Payroll for UK businesses."], ["c", null]]), S);
    expect(m.get("a")).toMatchObject({ normalised: 1, missing: false });
    expect(m.get("b")).toMatchObject({ normalised: 0, missing: false });
    expect(m.get("c")).toMatchObject({ normalised: 0.5, missing: true });
    expect((m.get("a")!.raw as { words: string[] }).words).toEqual(expect.arrayContaining(["chase", "overdue", "debtors"]));
    expect(bm25(["x"], new Map()).size).toBe(0);
  });
});

describe("ranking a line", () => {
  const pool = [
    app("chaser", { functions: ["Invoices", "Payments", "Contacts"] }, { rating_avg: 4.98, review_count: 374, description: "Chase overdue invoices, reduce debtor days.", xero_functions: ["Invoices", "Payments", "Contacts"] }),
    app("solid", {}, { rating_avg: 4.5, review_count: 40, description: "Invoicing and payments." }),
    app("tiny", {}, { rating_avg: 5, review_count: 1 }),
    app("usonly", { markets: ["US"] }),
    app("unknownmarket", { markets: [] }, null),
    app("payrollapp", { categories: ["payroll"] }),
  ];

  it("contributions add up to the match (±0.01) for every candidate", () => {
    const r = rankLine(line, rule("receivables"), ctx(pool));
    for (const c of r.candidates) expect(Math.abs(c.parts.reduce((t, p) => t + p.contribution, 0) - c.match)).toBeLessThanOrEqual(0.01);
  });

  it("filters by category and market: wrong category isn't a candidate; another market is excluded with a reason; unknown market is kept", () => {
    const r = rankLine(line, rule("receivables"), ctx(pool));
    const ids = r.candidates.map((c) => c.appId);
    expect(ids).not.toContain("payrollapp");
    expect(ids).toContain("unknownmarket");
    expect(r.excluded).toEqual([expect.objectContaining({ appId: "usonly", reason: expect.stringMatching(/Not available in UK/) })]);
    expect(r.warnings.join(" ")).toMatch(/unknown markets kept/);
  });

  it("the better-evidenced app ranks first; ranks are 1..n; the in-use app is always scored and has kind null", () => {
    const r = rankLine(line, rule("receivables"), ctx(pool, { inUse: new Set(["tiny"]) }));
    expect(r.candidates[0]!.appId).toBe("chaser");
    expect(r.candidates.map((c) => c.rank)).toEqual(r.candidates.map((_, i) => i + 1));
    expect(r.candidates.find((c) => c.appId === "tiny")).toMatchObject({ inUse: true, kind: null });
    expect(r.candidates.find((c) => c.appId === "chaser")!.kind).toBe("add");
  });

  it("ties: an app that handles the line ranks ahead of one that only helps, then by name", () => {
    const r = rule("payroll_no_bridge"); // app_categories [payroll, rota], covered_by [payroll]
    const twins = [app("b-rota", { categories: ["rota"] }, null), app("a-payroll", { categories: ["payroll"] }, null)];
    const res = rankLine({ ...line, ruleId: r.id }, r, ctx(twins));
    expect(res.candidates[0]!.appId).toBe("a-payroll");
    expect(res.candidates[0]!.handles).toBe(true);
  });

  it("fewer than 3 candidates → a catalogue-gap warning and a gap to queue", () => {
    const r = rankLine(line, rule("receivables"), ctx(pool.slice(0, 2)));
    expect(r.gap).toMatchObject({ ruleId: "receivables", markets: ["UK"], candidates: 2 });
    expect(r.warnings[0]).toMatch(/catalogue gap/);
    expect(rankLine(line, rule("receivables"), ctx(pool)).gap).toBeNull();
  });

  it("what-if weights re-rank without touching the YAML, and an invalid override is rejected", () => {
    const heavyPrice = withOverrides(S, { weights: { strength: 0.1, fit: 0.1, quality: 0.1, price: 0.7 } });
    expect(heavyPrice.weights.price).toBe(0.7);
    expect(rulesFile().scoring_v2!.weights.price).toBe(0.05);
    expect(() => withOverrides(S, { weights: { price: 5 } } as never)).toThrow();
  });

  it("the trace carries the line, weights, formula and every part", () => {
    const res = rankLine(line, rule("receivables"), ctx(pool));
    const t = v2Trace({ orgId: "o", computedAt: "2026-11-23T00:00:00Z", scoring: S, rulesVersion: "abc" }, line, res);
    expect(t).toMatchObject({ engine: "v2", lineKey: line.lineKey, line: { ruleId: "receivables" }, excluded: res.excluded });
    expect(t.candidates[0]!.parts.map((p) => p.key)).toEqual(["strength", "integration_fit", "category_match", "function_match", "keyword_match", "rating_score", "volume_score", "award_boost", "price"]);
    expect(t.candidates[0]!.formula).toMatch(/^100 × \(/);
    expect(t.weights["job_fit.keyword_match"]).toBe(S.job_fit.keyword_match);
  });
});

describe("shadow mode never changes flags", () => {
  it("rankFlagsV2 reads v1's flags and leaves them exactly as they were; only flagged and covered lines are ranked", () => {
    const f = (lineKey: string, state: FlagOut["state"], ruleId: string | null, strength: number): FlagOut => ({
      kind: "bs", lineKey, xeroAccountId: null, ruleId, ruleVersion: 1, value: 10_000, base: 100_000, materiality: 0.1, band: "high",
      coverageGap: 1, strength, state, evidence: {}, cause: null, recommendations: [],
    });
    const flags = [f("bs:trade_debtors", "flagged", "receivables", 0.1), f("pl:wages", "covered", "payroll_no_bridge", 0), f("pl:rent", "fine", null, 0), f("pl:x", "queued", null, 0)];
    const before = JSON.stringify(flags);
    const out = rankFlagsV2({ flags, lines: [], inUse: [], markets: ["UK"], annualRevenue: 1e6, headcount: null, today: "2026-11-23" });
    expect(JSON.stringify(flags)).toBe(before);
    expect(out.map((o) => o.line.lineKey).sort()).toEqual(["bs:trade_debtors", "pl:wages"]);
    expect(out.find((o) => o.line.lineKey === "pl:wages")!.result.candidates.every((c) => c.inUse || c.kind === "change")).toBe(true);
  });

  it("every listing is in the pool once; catalogue apps keep their own id and categories", () => {
    const pool = v2Apps();
    expect(new Set(pool.map((a) => a.id)).size).toBe(pool.length);
    const cin7 = pool.find((a) => a.id === "cin7")!;
    expect(cin7.curated).not.toBeNull();
    expect(cin7.listing?.listing_id).toMatch(/^xa-cin7/);
    expect(pool.some((a) => a.id === "xa-cin7-omni" || a.id === "xa-cin7-core")).toBe(false);
    expect(pool.find((a) => a.id === "xa-solido")).toBeTruthy();
  });

  it("every rule's Xero functions are real Xero object names", async () => {
    const fs = await import("node:fs");
    const { parse } = await import("yaml");
    const vocab = new Set(Object.keys((parse(fs.readFileSync("catalog/xero-functions.yaml", "utf8")) as { functions: object }).functions));
    for (const r of rulesFile().rules as Rule[]) for (const fn of [...r.required_functions, ...r.helpful_functions]) expect(vocab.has(fn), `${r.id}: ${fn}`).toBe(true);
  });
});

describe("shadow mode in a real refresh (sample business, throwaway db)", () => {
  let close: () => Promise<void>;
  let orgId: string;
  let runId: string;
  beforeAll(async () => {
    const { freshDb } = await import("./helpers/db");
    const { adminDb } = await import("@/lib/db/client");
    const { orgs } = await import("@/db/schema");
    const { runRefresh } = await import("@/lib/sync/refresh");
    const { FixtureXeroClient } = await import("@/lib/xero/client");
    const h = await freshDb();
    close = h.close;
    const [o] = await (await adminDb()).insert(orgs).values({ name: "Copperpot (sample)", sample: true }).returning();
    orgId = o!.id;
    runId = (await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") })).runId;
  }, 120_000);
  afterAll(() => close?.());

  it("v2 rows are stored for every flagged and covered line, apart from v1's, with parts that add up", async () => {
    const { withOrg } = await import("@/lib/db/client");
    const { flags, recommendations, recommendationsV2 } = await import("@/db/schema");
    const { fs, v1, v2 } = await withOrg(orgId, async (tx) => ({
      fs: await tx.select().from(flags).where(eq(flags.runId, runId)),
      v1: await tx.select().from(recommendations),
      v2: await tx.select().from(recommendationsV2),
    }));
    const ranked = fs.filter((f) => (f.state === "flagged" || f.state === "covered") && !(f.evidence as Record<string, unknown>).declared);
    expect(ranked.length).toBeGreaterThan(0);
    for (const f of ranked) expect(v2.some((r) => r.flagId === f.id), f.lineKey).toBe(true);
    expect(v1.length).toBeGreaterThan(0); // v1 still written for customers
    for (const r of v2) {
      const parts = (r.components as { parts: { contribution: number }[] }).parts;
      expect(Math.abs(parts.reduce((t, p) => t + p.contribution, 0) - r.match)).toBeLessThanOrEqual(0.01);
    }
  });
});

void ({} as ScoringV2);

describe("dev tools gate", () => {
  it("the engine trace API is 404 while DEV_TOOLS is off, whoever asks", async () => {
    const { resetEnv } = await import("@/lib/env");
    const { requireDevTools } = await import("@/lib/rank/v2/dev");
    const prev = process.env.DEV_TOOLS;
    process.env.DEV_TOOLS = "false";
    resetEnv();
    await expect(requireDevTools()).rejects.toMatchObject({ status: 404 });
    process.env.DEV_TOOLS = prev;
    resetEnv();
  });
});
