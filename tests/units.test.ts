import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { accountCategories, apps, rulesFile, validateCatalog } from "@/lib/catalog/load";
import { matchAccount } from "@/lib/mapping/rules";
import { mapAccounts } from "@/lib/mapping";
import { normaliseName } from "@/lib/detect/normalise";
import { jaroWinkler, matchSupplier } from "@/lib/detect/match";
import { catalogFingerprints } from "@/lib/detect";
import { buildBS, buildPL, type AcctInfo } from "@/lib/statements/build";
import { deriveCashFlow } from "@/lib/statements/cashflow";
import { parseReport } from "@/lib/xero/parse-report";
import { AccountsResponse } from "@/lib/xero/schemas";
import { bandOf, computeFlags, orderFlags, type FlagCtx, type LineIn } from "@/lib/signals/compute";
import { priceFit } from "@/lib/rank/score";
import { financialYear, latestMonthEnd } from "@/lib/sync/periods";
import { refHash } from "@/lib/queue/enqueue";

const DIR = "fixtures/xero/demo-uk-synthetic";
const load = (f: string) => JSON.parse(fs.readFileSync(`${DIR}/${f}`, "utf8"));

describe("catalogue", () => {
  it("is internally consistent", () => expect(validateCatalog()).toEqual([]));
  it("every seeded app is labelled sample", () => expect(apps().every((a) => a.sample)).toBe(true));
});

describe("periods", () => {
  it("latest month end is the previous calendar month", () => {
    expect(latestMonthEnd(new Date("2026-11-04T00:00:00Z"))).toBe("2026-10-31");
    expect(latestMonthEnd(new Date("2026-03-01T00:00:00Z"))).toBe("2026-02-28");
    expect(latestMonthEnd(new Date("2026-11-04T00:00:00Z"), true)).toBe("2026-11-30");
  });
  it("financial year for a 31 March year end", () => {
    expect(financialYear("2026-10-31", 3, 31)).toEqual({ start: "2026-04-01", priorEnd: "2026-03-31" });
    expect(financialYear("2026-03-31", 3, 31)).toEqual({ start: "2025-04-01", priorEnd: "2025-03-31" });
    expect(financialYear("2026-10-31", 12, 31)).toEqual({ start: "2026-01-01", priorEnd: "2025-12-31" });
  });
});

describe("account mapping", () => {
  const cats = accountCategories();
  const acc = (name: string, type: string, extra: Record<string, string> = {}) => ({ xeroAccountId: name, name, type, ...extra });
  it.each([
    [acc("Wages and Salaries", "OVERHEADS", { reportingCode: "EXP.EMP.WAG" }), "wages", 0.9],
    [acc("Accounts Receivable", "CURRENT", { systemAccount: "DEBTORS" }), "trade_debtors", 0.95],
    [acc("Business Bank Account", "BANK"), "bank", 0.9],
    [acc("Office Rent", "OVERHEADS"), "rent", 0.8],
    [acc("Short-term Loan", "CURRLIAB"), "short_term_loans", 0.8],
  ])("%o → %s", (a, cat, conf) => {
    const m = matchAccount(a, cats)!;
    expect(m.category).toBe(cat);
    expect(m.confidence).toBeGreaterThanOrEqual(conf);
  });
  it("word-start matching: 'rent' does not match 'Current'", () => {
    expect(matchAccount(acc("Current Account Fees", "OVERHEADS"), cats)?.category).not.toBe("rent");
  });
  it("below the bar → unmapped; confirmed beats rules; LLM is capped at 0.8", async () => {
    const accounts = [acc("Sundry adjustments", "EXPENSE"), acc("Wages", "OVERHEADS"), acc("Mystery", "EXPENSE")];
    const llm = async (xs: { name: string; type: string }[]) => {
      expect(xs.every((x) => Object.keys(x).sort().join() === "name,type")).toBe(true); // names + types only
      return xs.map((x) => (x.name === "Mystery" ? { category: "office_general", confidence: 0.99 } : null));
    };
    const { maps, unmapped } = await mapAccounts({ accounts, categories: cats, confirmed: new Map([["Wages", "contractors"]]), minConfidence: 0.75, llm });
    expect(maps.find((m) => m.xeroAccountId === "Wages")).toMatchObject({ category: "contractors", source: "confirmed", confidence: 1 });
    expect(maps.find((m) => m.xeroAccountId === "Mystery")).toMatchObject({ category: "office_general", source: "llm", confidence: 0.8 });
    expect(unmapped.map((u) => u.name)).toEqual(["Sundry adjustments"]);
  });
});

describe("supplier detection", () => {
  it.each([
    ["GOOGLE*GSUITE COPPERPOT", "google gsuite copperpot"],
    ["MSFT * E0300ABCD", "msft"],
    ["Pleo Technologies ApS", "pleo technologies"],
    ["Xero (UK) Ltd", "xero"],
    ["EE Limited DD", "ee"],
    ["DEPUTY.COM*SUB 4482", "deputy com sub"],
  ])("normalise %s → %s", (raw, out) => expect(normaliseName(raw)).toBe(out));

  const fps = catalogFingerprints();
  it("exact → alias → fuzzy", () => {
    expect(matchSupplier("deputy", fps)).toMatchObject({ appId: "deputy", kind: "exact" });
    expect(matchSupplier("pleo technologies", fps)).toMatchObject({ appId: "pleo", kind: "alias" });
    expect(matchSupplier("fathum", fps)).toMatchObject({ appId: "fathom", kind: "fuzzy_check" });
    expect(matchSupplier("float glass", fps)).toBeNull(); // short ambiguous names are exact-only
    expect(matchSupplier("brakes bros", fps)).toBeNull();
  });
  it("jaro-winkler sanity", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("abc", "abc")).toBe(1);
  });
});

describe("derived cash flow", () => {
  const accounts = AccountsResponse.parse(load("accounts.json")).Accounts;
  const info = (drop?: string) =>
    new Map<string, AcctInfo>(
      accounts.map((a) => [
        a.AccountID,
        { xeroAccountId: a.AccountID, code: a.Code ?? null, name: a.Name, type: a.Code === drop ? "" : a.Type, systemAccount: a.SystemAccount ?? null, category: a.Code === "840" ? "short_term_loans" : a.Code === "960" ? "retained_earnings" : "x" },
      ]),
    );
  const build = (i: Map<string, AcctInfo>) =>
    deriveCashFlow({
      pl: buildPL(parseReport(load("pl.json")), i, { from: "2026-04-01", to: "2026-10-31" }),
      open: buildBS(parseReport(load("bs-open.json")), i, "2026-03-31"),
      close: buildBS(parseReport(load("bs-close.json")), i, "2026-10-31"),
      accounts: i,
      period: { from: "2026-04-01", to: "2026-10-31" },
    });

  it("hand-built fixture with a known answer reconciles", () => {
    const cf = build(info());
    expect(cf.reconciled).toBe(true);
    expect(cf.totals).toMatchObject({ cfo: 490_000, cfi: -66_000, cff: -105_000, delta_bank: 319_000, check: 0 });
    expect(cf.lines.find((l) => l.lineKey === "cf:610")).toMatchObject({ value: -33_500, section: "operating" });
    expect(cf.lines.find((l) => l.lineKey === "cf:840")).toMatchObject({ value: -15_000, section: "financing" });
  });

  it("a missing account type fails reconciliation and names the account", () => {
    const cf = build(info("610"));
    expect(cf.reconciled).toBe(false);
    expect(cf.totals.check).toBe(33_500); // the AR increase never gets deducted from operating cash
    expect(cf.unclassified.map((u) => u.name)).toEqual(["Accounts Receivable"]);
    expect(cf.checks[0]).toContain("£33500.00 unexplained");
  });
});

describe("flag computation", () => {
  const rf = rulesFile();
  const base: FlagCtx = {
    revenue: 1_000_000,
    totalAssets: 500_000,
    monthsInPeriod: 12,
    cfReconciled: true,
    rules: rf.rules,
    apps: apps(),
    markets: ["UK"],
    inUse: new Map(),
    prices: new Map(),
    overrides: new Map(),
    tb: new Map(),
    bands: { high: 0.1, medium: 0.02 },
    scoring: rf.scoring,
  };
  const line = (o: Partial<LineIn>): LineIn => ({ kind: "pl", lineKey: "pl:477", xeroAccountId: "a", code: "477", name: "Wages", category: "wages", value: 200_000, ...o });

  it("bands", () => {
    expect(bandOf(0.1, base.bands)).toBe("high");
    expect(bandOf(0.0999, base.bands)).toBe("medium");
    expect(bandOf(0.02, base.bands)).toBe("medium");
    expect(bandOf(0.0199, base.bands)).toBe("low");
  });

  it("covers every state", () => {
    const [flagged] = computeFlags([line({})], base);
    expect(flagged).toMatchObject({ state: "flagged", coverageGap: 1, materiality: 0.2, band: "high", strength: 0.2 });
    expect(computeFlags([line({ category: "unmapped" })], base)[0]!.state).toBe("queued");
    expect(computeFlags([line({ kind: "cf", lineKey: "cf:477" })], { ...base, cfReconciled: false })[0]!.state).toBe("queued");
    expect(computeFlags([line({ category: "rent" })], base)[0]!.state).toBe("fine");
    expect(computeFlags([line({ value: 500 })], base)[0]!.state).toBe("fine"); // under min_value_gbp
    const ov = (state: "marked_fine" | "snoozed" | "queued" | "declared", extra: { until?: string; appId?: string } = {}) =>
      new Map([["pl:477|payroll_no_bridge", { state, until: extra.until ?? null, appId: extra.appId ?? null }]]);
    expect(computeFlags([line({})], { ...base, overrides: ov("marked_fine") })[0]!.state).toBe("marked_fine");
    // v1.1 D: not now → snoozed until the date, then flagged again; numbers wrong → queued; an app they use → covered.
    expect(computeFlags([line({})], { ...base, today: "2026-11-09", overrides: ov("snoozed", { until: "2027-02-07" }) })[0]!.state).toBe("snoozed");
    expect(computeFlags([line({})], { ...base, today: "2027-02-07", overrides: ov("snoozed", { until: "2027-02-07" }) })[0]!.state).toBe("flagged");
    expect(computeFlags([line({})], { ...base, overrides: ov("queued") })[0]!.state).toBe("queued");
    const declared = computeFlags([line({})], { ...base, overrides: ov("declared", { appId: "brightpay" }) })[0]!;
    expect(declared).toMatchObject({ state: "covered", coverageGap: 0, evidence: { covered_by: "brightpay", declared: true } });
    // A rota app only helps with payroll → gap 0.5. A payroll app in use covers it, even if another ranks higher.
    const staff = { appId: "staffology", spend12m: 1200, monthsSeen: 12 };
    const dep = { appId: "deputy", spend12m: 2400, monthsSeen: 12 };
    const half = computeFlags([line({})], { ...base, inUse: new Map([["deputy", dep]]) })[0]!;
    expect(half).toMatchObject({ state: "flagged", coverageGap: 0.5 });
    const alone = computeFlags([line({})], { ...base, inUse: new Map([["staffology", staff]]) })[0]!;
    expect(alone.state).toBe("covered");
    // Deputy ranks higher overall but is a rota app, so it's not offered as a payroll switch.
    expect(alone.evidence.switch_option).toBeUndefined();
    const covered = computeFlags([line({})], { ...base, inUse: new Map([["staffology", staff], ["deputy", dep]]) })[0]!;
    expect(covered).toMatchObject({ state: "covered", coverageGap: 0, strength: 0 });
    expect(covered.recommendations[0]).toMatchObject({ inUse: true });
  });

  it("BS lines use total assets as the base", () => {
    const [f] = computeFlags([line({ kind: "bs", lineKey: "bs:610", category: "trade_debtors", value: 100_000 })], base);
    expect(f).toMatchObject({ base: 500_000, materiality: 0.2 });
  });

  it("orders flagged by |value|, then covered, then the rest", () => {
    const o = orderFlags([
      { state: "fine" as const, value: 9e9 },
      { state: "flagged" as const, value: -5 },
      { state: "covered" as const, value: 100 },
      { state: "flagged" as const, value: 50 },
    ]);
    expect(o.map((x) => `${x.state}:${x.value}`)).toEqual(["flagged:50", "flagged:-5", "covered:100", "fine:9000000000"]);
  });

  it("price_fit is neutral (0.5) when the price is missing — never estimated", () => {
    const app = { ...apps().find((a) => a.id === "staffology")!, revenue_band: { min: 0, max: 5_000_000 } };
    expect(priceFit(app, undefined, 1_000_000, rf.scoring)).toBe(0.5);
    expect(priceFit(app, { known: false }, 1_000_000, rf.scoring)).toBe(0.5);
    expect(priceFit(app, { known: true }, 1_000_000, rf.scoring)).toBe(1);
  });
});

describe("queue dedupe key", () => {
  it("is independent of key order", () => expect(refHash({ a: 1, b: 2 })).toBe(refHash({ b: 2, a: 1 })));
});
