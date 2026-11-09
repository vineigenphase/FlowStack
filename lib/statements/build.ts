/** Build P&L and balance sheet statements from parsed Xero reports (BACKEND.md §3.4, §3.6). Pure. */
import type { ParsedReport } from "@/lib/xero/parse-report";
import { totalOf } from "@/lib/xero/parse-report";

export type AcctInfo = {
  xeroAccountId: string;
  code: string | null;
  name: string;
  type: string;
  systemAccount: string | null;
  category: string | null; // null or "unmapped" when unsure
};

export type StatementKind = "pl" | "bs" | "cf";

export type StatementLine = {
  lineKey: string;
  xeroAccountId: string | null;
  code: string | null;
  name: string;
  section: string;
  category: string | null;
  value: number;
  sort: number;
};

export type Statement = {
  kind: StatementKind;
  periodFrom: string | null;
  periodTo: string;
  derived: boolean;
  lines: StatementLine[];
  totals: Record<string, number>;
  /** Totals that don't add up (report total vs sum of lines). Empty when consistent. */
  checks: string[];
  reconciled?: boolean;
  reconDiff?: number;
};

export const SECTION_LABELS: Record<string, string> = {
  income: "Income",
  cost_of_sales: "Cost of sales",
  opex: "Overheads",
  other_income: "Other income",
  other_expenses: "Other expenses",
  bank: "Bank",
  current_assets: "Current assets",
  fixed_assets: "Fixed assets",
  non_current_assets: "Non-current assets",
  current_liabilities: "Current liabilities",
  non_current_liabilities: "Non-current liabilities",
  equity: "Equity",
  operating: "Operating activities",
  investing: "Investing activities",
  financing: "Financing activities",
};

export function sectionKey(title: string): string {
  const t = title.toLowerCase().replace(/^less\s+/, "").trim();
  if (/^(income|trading income|revenue|turnover|sales)$/.test(t)) return "income";
  if (/cost of sales|cost of goods|direct costs/.test(t)) return "cost_of_sales";
  if (/^other income/.test(t)) return "other_income";
  if (/operating expenses|^expenses$|overheads|administrative/.test(t)) return "opex";
  if (/^other expenses|non-operating/.test(t)) return "other_expenses";
  if (/^bank/.test(t)) return "bank";
  if (/^current assets/.test(t)) return "current_assets";
  if (/^fixed assets/.test(t)) return "fixed_assets";
  if (/^non-current assets|^non current assets/.test(t)) return "non_current_assets";
  if (/^current liabilities/.test(t)) return "current_liabilities";
  if (/^non-current liabilities|^non current liabilities|^long term liabilities/.test(t)) return "non_current_liabilities";
  if (/^equity/.test(t)) return "equity";
  return t.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other";
}

export const lineKeyFor = (kind: StatementKind, a: { code: string | null; xeroAccountId: string | null }, fallback?: string) =>
  `${kind}:${a.code || a.xeroAccountId || fallback}`;

function linesFrom(kind: StatementKind, rep: ParsedReport, accounts: Map<string, AcctInfo>): StatementLine[] {
  const out: StatementLine[] = [];
  const byKey = new Map<string, StatementLine>();
  rep.rows.forEach((r, i) => {
    if (!r.accountId || r.isSummary) return;
    const a = accounts.get(r.accountId);
    const lineKey = lineKeyFor(kind, { code: a?.code ?? null, xeroAccountId: r.accountId });
    // If the same account appears on more than one row of a report, a second line with the same key would fail
    // the save (statement_lines primary key). One line per account: add the rows together.
    const seen = byKey.get(lineKey);
    if (seen) {
      seen.value = Math.round((seen.value + (r.values[0] ?? 0)) * 100) / 100;
      return;
    }
    const line: StatementLine = {
      lineKey,
      xeroAccountId: r.accountId,
      code: a?.code ?? null,
      name: a?.name ?? r.label,
      section: sectionKey(r.section),
      category: a?.category ?? null,
      value: r.values[0] ?? 0,
      sort: i,
    };
    byKey.set(lineKey, line);
    out.push(line);
  });
  return out;
}

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
const close = (a: number, b: number) => Math.abs(a - b) < 0.01;

export function buildPL(rep: ParsedReport, accounts: Map<string, AcctInfo>, period: { from: string; to: string }): Statement {
  const lines = linesFrom("pl", rep, accounts);
  const inSec = (k: string) => sum(lines.filter((l) => l.section === k).map((l) => l.value));
  const revenueTotal = totalOf(rep, "Total Income") ?? totalOf(rep, "Total Trading Income") ?? totalOf(rep, "Total Revenue") ?? inSec("income");
  const netProfit = totalOf(rep, "Net Profit") ?? totalOf(rep, "Net Loss");
  const income = inSec("income") + inSec("other_income");
  const costs = sum(lines.filter((l) => !["income", "other_income"].includes(l.section)).map((l) => l.value));
  const checks: string[] = [];
  if (netProfit !== null && !close(income - costs, netProfit)) checks.push(`P&L lines give net profit ${income - costs}, Xero says ${netProfit}`);
  return {
    kind: "pl",
    periodFrom: period.from,
    periodTo: period.to,
    derived: false,
    lines,
    totals: { revenue: revenueTotal, net_profit: netProfit ?? income - costs, total_costs: costs },
    checks,
  };
}

export function buildBS(rep: ParsedReport, accounts: Map<string, AcctInfo>, asAt: string): Statement {
  const lines = linesFrom("bs", rep, accounts);
  const cye = rep.rows.find((r) => !r.accountId && /current year earnings/i.test(r.label));
  if (cye) {
    lines.push({
      lineKey: "bs:current_year_earnings",
      xeroAccountId: null,
      code: null,
      name: "Current Year Earnings",
      section: "equity",
      category: null,
      value: cye.values[0] ?? 0,
      sort: rep.rows.indexOf(cye),
    });
  }
  const inSecs = (ks: string[]) => sum(lines.filter((l) => ks.includes(l.section)).map((l) => l.value));
  const totalAssets = totalOf(rep, "Total Assets") ?? inSecs(["bank", "current_assets", "fixed_assets", "non_current_assets"]);
  const totalLiabilities = totalOf(rep, "Total Liabilities") ?? inSecs(["current_liabilities", "non_current_liabilities"]);
  const totalEquity = totalOf(rep, "Total Equity") ?? inSecs(["equity"]);
  const checks: string[] = [];
  const assetLines = inSecs(["bank", "current_assets", "fixed_assets", "non_current_assets"]);
  if (!close(assetLines, totalAssets)) checks.push(`Asset lines sum to ${assetLines}, Xero says ${totalAssets}`);
  if (!close(totalAssets - totalLiabilities, totalEquity)) checks.push("Balance sheet does not balance");
  return {
    kind: "bs",
    periodFrom: null,
    periodTo: asAt,
    derived: false,
    lines,
    totals: { total_assets: totalAssets, total_liabilities: totalLiabilities, total_equity: totalEquity, current_year_earnings: cye?.values[0] ?? 0 },
    checks,
  };
}
