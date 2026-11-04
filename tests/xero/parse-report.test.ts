import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmount, parseReport, totalOf } from "@/lib/xero/parse-report";
import { AccountsResponse } from "@/lib/xero/schemas";

const ROOT = path.resolve("fixtures/xero");
const sets = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, "pl.json")));
const load = (set: string, f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, set, f), "utf8"));

describe("parseAmount", () => {
  it.each([
    ["1,234.56", 1234.56],
    ["(1,234.56)", -1234.56],
    ["-50.00", -50],
    ["", 0],
    [undefined, 0],
    ["£12.00", 12],
  ])("%s → %s", (input, out) => expect(parseAmount(input)).toBe(out));
});

describe.each(sets)("parseReport on fixtures/%s", (set) => {
  const accounts = AccountsResponse.parse(load(set, "accounts.json")).Accounts;
  const ids = new Set(accounts.map((a) => a.AccountID));

  it("P&L: account rows sum to Net Profit and every account id resolves", () => {
    const pl = parseReport(load(set, "pl.json"));
    expect(pl.name).toBe("Profit and Loss");
    const lines = pl.rows.filter((r) => !r.isSummary);
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) expect(ids.has(l.accountId!), l.label).toBe(true);
    const classOf = new Map(accounts.map((a) => [a.AccountID, a.Class]));
    const np = lines.reduce((s, l) => s + (classOf.get(l.accountId!) === "REVENUE" ? 1 : -1) * l.values[0]!, 0);
    expect(np).toBeCloseTo(totalOf(pl, "Net Profit")!, 2);
  });

  it("BS: assets − liabilities = net assets = total equity", () => {
    for (const f of ["bs-open.json", "bs-close.json"]) {
      const bs = parseReport(load(set, f));
      const ta = totalOf(bs, "Total Assets")!;
      const tl = totalOf(bs, "Total Liabilities")!;
      expect(ta - tl).toBeCloseTo(totalOf(bs, "Net Assets")!, 2);
      expect(totalOf(bs, "Total Equity")).toBeCloseTo(ta - tl, 2);
      const cye = bs.rows.find((r) => r.label === "Current Year Earnings");
      expect(cye?.accountId ?? null).toBeNull();
    }
  });

  it("TB: header columns and balanced YTD debits/credits", () => {
    const tb = parseReport(load(set, "tb.json"));
    expect(tb.columns).toEqual(["Account", "Debit", "Credit", "YTD Debit", "YTD Credit"]);
    const lines = tb.rows.filter((r) => r.accountId);
    const d = lines.reduce((s, l) => s + l.values[2]!, 0);
    const c = lines.reduce((s, l) => s + l.values[3]!, 0);
    expect(d).toBeCloseTo(c, 2);
  });

  if (set.endsWith("-synthetic")) {
    it("matches the totals the synthetic set was built to produce", () => {
      const exp = load(set, "_expected.json");
      const pl = parseReport(load(set, "pl.json"));
      expect(totalOf(pl, "Net Profit")).toBe(exp.netProfit);
      expect(totalOf(pl, "Total Income")).toBe(exp.revenue);
      expect(totalOf(pl, "Gross Profit")).toBe(exp.grossProfit);
    });
  }
});
