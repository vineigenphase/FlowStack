/** Stack map: function status, one function per line, Xero links and fix order (lib/map/build.ts). */
import { describe, expect, it } from "vitest";
import { buildStackMap, linkToXero, type MapLine } from "@/lib/map/build";
import { App, Rule } from "@/lib/catalog/load";

const app = (o: Partial<App> & { id: string; categories: string[] }) => App.parse({ name: o.id, markets: ["UK"], ...o });
const apps = [
  app({ id: "xero", categories: ["accounting"] }),
  app({ id: "deputy", name: "Deputy", categories: ["rota"], integrations: [{ to: "xero", kind: "native" }, { to: "staffology", kind: "native" }] }),
  app({ id: "staffology", name: "Staffology", categories: ["payroll"], integrations: [{ to: "xero", kind: "native" }, { to: "deputy", kind: "native" }] }),
  app({ id: "rotaready", name: "Rotaready", categories: ["rota"], integrations: [{ to: "xero", kind: "csv" }, { to: "staffology", kind: "native" }] }),
  app({ id: "chaser", name: "Chaser", categories: ["billing_receivables"], integrations: [{ to: "xero", kind: "native" }] }),
  app({ id: "pleo", name: "Pleo", categories: ["spend_payables"], integrations: [{ to: "xero", kind: "native" }] }),
  app({ id: "bridge", name: "Bridge", categories: ["fpa"], integrations: [{ to: "staffology", kind: "native" }] }),
];
const rules = [
  Rule.parse({ id: "payroll", account_categories: ["wages"], app_categories: ["payroll", "rota"], covered_by: ["payroll"], statements: ["pl"] }),
  Rule.parse({ id: "receivables", account_categories: ["receivables"], app_categories: ["billing_receivables"], statements: ["bs", "cf"] }),
  Rule.parse({ id: "spend", account_categories: ["card"], app_categories: ["spend_payables"], statements: ["pl"] }),
];
const categories = ["payroll", "rota", "billing_receivables", "spend_payables", "fpa", "inventory"].map((key) => ({ key, label: key }));
const line = (o: Partial<MapLine> & { key: string }): MapLine => ({ name: o.key, code: null, kind: "pl", state: "flagged", value: 1000, materiality: 0.1, ruleId: null, ...o });

describe("linkToXero", () => {
  const byId = new Map(apps.map((a) => [a.id, a]));
  it("direct, through an app in use, by CSV, or unknown", () => {
    expect(linkToXero(byId.get("deputy")!, new Set(), byId)).toEqual({ link: "native", via: null });
    expect(linkToXero(byId.get("bridge")!, new Set(["staffology"]), byId)).toEqual({ link: "via_app", via: "Staffology" });
    expect(linkToXero(byId.get("bridge")!, new Set(), byId)).toEqual({ link: "unknown", via: null });
    expect(linkToXero(byId.get("rotaready")!, new Set(), byId)).toEqual({ link: "csv", via: null });
    expect(linkToXero(byId.get("rotaready")!, new Set(["staffology"]), byId)).toEqual({ link: "via_app", via: "Staffology" });
  });
});

describe("buildStackMap", () => {
  const m = buildStackMap({
    categories,
    apps,
    rules,
    inUse: [
      { appId: "xero", spend12m: 600, monthsSeen: 12, present: true }, // the ledger itself: never "works with"
      { appId: "deputy", spend12m: 2500, monthsSeen: 12, present: true },
      { appId: "pleo", spend12m: 1000, monthsSeen: 12, present: true },
      { appId: "chaser", spend12m: 300, monthsSeen: 2, present: false }, // stopped paying: not on the map
    ],
    lines: [
      line({ key: "pl:477", ruleId: "payroll", value: 690000, materiality: 0.27 }),
      line({ key: "pl:478", ruleId: "payroll", value: 70000, materiality: 0.03 }),
      line({ key: "bs:825", kind: "bs", ruleId: "payroll", value: 41200, materiality: 0.02 }), // a balance: no £ at stake
      line({ key: "bs:610", kind: "bs", ruleId: "receivables", value: 121500 }),
      line({ key: "cf:610", kind: "cf", ruleId: "receivables", value: -33500 }), // restates bs:610: never counted
      line({ key: "pl:420", ruleId: "spend", state: "covered", value: 5000 }),
      line({ key: "pl:999", ruleId: null, state: "queued" }),
    ],
    recs: [
      { lineKey: "pl:477", appId: "staffology", rank: 1, match: 77, inUse: false },
      { lineKey: "pl:477", appId: "deputy", rank: 2, match: 59, inUse: true },
      { lineKey: "bs:610", appId: "chaser", rank: 1, match: 51, inUse: false },
    ],
  });
  const fn = (k: string) => m.functions.find((f) => f.key === k)!;

  it("payroll lines land in payroll only (covered_by), not rota", () => {
    expect(fn("payroll").lines.map((l) => l.key)).toEqual(["pl:477", "pl:478", "bs:825"]);
    expect(fn("rota").lines).toEqual([]);
  });

  it("statuses: gap, connected, quiet; absent apps are ignored", () => {
    expect(fn("payroll").status).toBe("gap");
    expect(fn("payroll").atStake).toBe(760000);
    expect(fn("rota").status).toBe("connected");
    expect(fn("spend_payables").status).toBe("connected");
    expect(fn("billing_receivables").status).toBe("gap");
    expect(fn("billing_receivables").apps).toEqual([]);
    expect(fn("inventory").status).toBe("quiet");
  });

  it("£ at stake follows the summary: flagged P&L cost lines only (no balances, no cash flow)", () => {
    expect(fn("payroll").atStake).toBe(760000);
    expect(fn("billing_receivables").atStake).toBe(0);
    expect(fn("billing_receivables").lines.map((l) => l.key)).toEqual(["bs:610"]);
  });

  it("revenue lines are flagged on the map but carry no £ at stake", () => {
    const m3 = buildStackMap({ categories, apps, rules, inUse: [], recs: [], lines: [line({ key: "pl:420", ruleId: "spend", revenue: true })] });
    expect(m3.functions.find((f) => f.key === "spend_payables")).toMatchObject({ status: "gap", atStake: 0 });
  });

  it("suggests the best app not in use, and what it works with", () => {
    expect(fn("payroll").suggestion).toMatchObject({ id: "staffology", worksWith: ["Deputy"] });
  });

  it("fixes: biggest gap first, numbered, with evidence", () => {
    expect(m.fixes.map((f) => [f.n, f.kind, f.fn])).toEqual([
      [1, "add", "payroll"],
      [2, "add", "billing_receivables"],
    ]);
    expect(m.fixes[0]!.lineKeys).toEqual(["pl:477", "pl:478", "bs:825"]);
    expect(m.fixes[0]!.why).toContain("works directly with Deputy");
  });

  it("an app reaching Xero by CSV is part by hand, and its fix comes before any add", () => {
    const m2 = buildStackMap({
      categories,
      apps,
      rules,
      inUse: [{ appId: "rotaready", spend12m: 900, monthsSeen: 12, present: true }],
      lines: [line({ key: "pl:477", ruleId: "payroll", value: 690000 })],
      recs: [],
    });
    expect(m2.functions.find((f) => f.key === "rota")!.status).toBe("part_manual");
    expect(m2.fixes.map((f) => [f.n, f.kind, f.fn])).toEqual([
      [1, "fix", "rota"],
      [2, "add", "payroll"],
    ]);
    expect(m2.fixes[0]!.title).toBe("Connect Rotaready to Xero directly");
  });
});
