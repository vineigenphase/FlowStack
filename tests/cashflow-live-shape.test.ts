/**
 * Regression: live Xero tags the balance sheet's "Current Year Earnings" row with a placeholder account id
 * (abababab-…). Before the fix the cash flow counted last year's result rolling into retained earnings as
 * financing cash and failed reconciliation by exactly that amount. Figures are the Xero Demo Company (UK)
 * (Xero's own sample data), FY 1 Apr–31 Oct 2026, as built by the first live refresh.
 */
import { describe, expect, it } from "vitest";
import { parseReport } from "@/lib/xero/parse-report";
import { buildBS, type AcctInfo, type Statement } from "@/lib/statements/build";
import { deriveCashFlow } from "@/lib/statements/cashflow";

// Written out (not imported) so the test means something without the fix.
const XERO_PLACEHOLDER_ACCOUNT_ID = "abababab-abab-abab-abab-abababababab";

type Acct = AcctInfo & { section: string };
const A: Record<string, Acct> = {
  bank: { xeroAccountId: "00000000-0000-4000-8000-000000000090", code: "090", name: "Business Bank Account", type: "BANK", systemAccount: null, category: "bank", section: "Bank" },
  ar: { xeroAccountId: "00000000-0000-4000-8000-000000000610", code: "610", name: "Accounts Receivable", type: "CURRENT", systemAccount: "DEBTORS", category: "trade_debtors", section: "Current Assets" },
  office: { xeroAccountId: "00000000-0000-4000-8000-000000000710", code: "710", name: "Office Equipment", type: "FIXED", systemAccount: null, category: "fixed_assets", section: "Fixed Assets" },
  computers: { xeroAccountId: "00000000-0000-4000-8000-000000000720", code: "720", name: "Computer Equipment", type: "FIXED", systemAccount: null, category: "fixed_assets", section: "Fixed Assets" },
  ap: { xeroAccountId: "00000000-0000-4000-8000-000000000800", code: "800", name: "Accounts Payable", type: "CURRLIAB", systemAccount: "CREDITORS", category: "trade_creditors", section: "Current Liabilities" },
  claims: { xeroAccountId: "00000000-0000-4000-8000-000000000801", code: "801", name: "Unpaid Expense Claims", type: "CURRLIAB", systemAccount: null, category: "unmapped", section: "Current Liabilities" },
  vat: { xeroAccountId: "00000000-0000-4000-8000-000000000820", code: "820", name: "VAT", type: "CURRLIAB", systemAccount: "GST", category: "vat", section: "Current Liabilities" },
  hist: { xeroAccountId: "00000000-0000-4000-8000-000000000840", code: "840", name: "Historical Adjustment", type: "CURRLIAB", systemAccount: "HISTORICAL", category: "unmapped", section: "Current Liabilities" },
  re: { xeroAccountId: "00000000-0000-4000-8000-000000000960", code: "960", name: "Retained Earnings", type: "EQUITY", systemAccount: "RETAINEDEARNINGS", category: "retained_earnings", section: "Equity" },
};
const accounts = new Map<string, AcctInfo>(Object.values(A).map((a) => [a.xeroAccountId, a]));

const cell = (v: string, id?: string) => (id ? { Value: v, Attributes: [{ Id: "account", Value: id }] } : { Value: v });

/** A Xero BalanceSheet response in the live shape, including the placeholder-tagged Current Year Earnings row. */
function bsReport(values: Partial<Record<keyof typeof A, number>>, cye: number) {
  const sections = new Map<string, { label: string; id: string; v: number }[]>();
  for (const [k, v] of Object.entries(values)) {
    const a = A[k]!;
    sections.set(a.section, [...(sections.get(a.section) ?? []), { label: a.name, id: a.xeroAccountId, v: v! }]);
  }
  const equity = sections.get("Equity") ?? [];
  sections.delete("Equity");
  const rows = [...sections].map(([title, ls]) => ({
    RowType: "Section",
    Title: title,
    Rows: ls.map((l) => ({ RowType: "Row", Cells: [cell(l.label, l.id), cell(l.v.toFixed(2), l.id)] })),
  }));
  rows.push({
    RowType: "Section",
    Title: "Equity",
    Rows: [
      { RowType: "Row", Cells: [cell("Current Year Earnings", XERO_PLACEHOLDER_ACCOUNT_ID), cell(cye.toFixed(2), XERO_PLACEHOLDER_ACCOUNT_ID)] },
      ...equity.map((l) => ({ RowType: "Row", Cells: [cell(l.label, l.id), cell(l.v.toFixed(2), l.id)] })),
    ],
  });
  return { Reports: [{ ReportName: "Balance Sheet", Rows: [{ RowType: "Header", Cells: [cell(""), cell("date")] }, ...rows] }] };
}

const open = buildBS(parseReport(bsReport({ bank: -3667.92, ar: 500, ap: 96.25, hist: 4130.98, vat: -1165.79 }, -6229.36)), accounts, "2026-03-31");
const close = buildBS(
  parseReport(bsReport({ bank: 433.51, ar: 15246.77, computers: -985.67, office: 3569, ap: 7941.21, hist: 4130.98, claims: 34.9, vat: 386.56, re: -6229.36 }, 11999.32)),
  accounts,
  "2026-10-31",
);
const pl: Statement = { kind: "pl", periodFrom: "2026-04-01", periodTo: "2026-10-31", derived: false, lines: [], totals: { net_profit: 11999.32 }, checks: [] };

describe("live Xero balance sheet shape (Current Year Earnings placeholder id)", () => {
  it("parser treats the placeholder as no account", () => {
    const rows = parseReport(bsReport({}, 1)).rows;
    const cye = rows.find((r) => r.label === "Current Year Earnings")!;
    expect(cye.accountId).toBeNull();
    expect(cye.isSummary).toBe(true);
  });

  it("buildBS reads Current Year Earnings into totals and its stable line key", () => {
    expect(open.totals.current_year_earnings).toBe(-6229.36);
    expect(close.totals.current_year_earnings).toBe(11999.32);
    expect(close.lines.map((l) => l.lineKey)).toContain("bs:current_year_earnings");
    expect(close.lines.some((l) => l.xeroAccountId === XERO_PLACEHOLDER_ACCOUNT_ID)).toBe(false);
  });

  it("Demo Company cash flow reconciles to the bank movement", () => {
    const cf = deriveCashFlow({ pl, open, close, accounts, period: { from: "2026-04-01", to: "2026-10-31" } });
    expect(cf.unclassified).toEqual([]);
    expect(cf.totals).toMatchObject({ cfo: 6684.76, cfi: -2583.33, cff: 0, delta_bank: 4101.43, check: 0 });
    expect(cf.reconciled).toBe(true);
  });
});
