/**
 * Derived cash flow statement, indirect method (BACKEND.md §4). Pure.
 *
 *   CFO = net_profit + depreciation − Δwc_assets + Δwc_liabs
 *   CFI = −(Δ fixed assets NBV + depreciation)
 *   CFF = Δ term liabilities + Δ short-term loans + Δ equity (excl. current-year earnings and the RE roll)
 *   check = CFO + CFI + CFF − Δ bank      reconciled if |check| ≤ max(£100, 0.5% × |Δ bank|)
 *
 * Any balance-sheet account whose Xero type we can't classify is left out; the check then fails
 * and the caller opens a review-queue item instead of flagging cash flow lines.
 */
import type { AcctInfo, Statement, StatementLine } from "./build";

const WC_ASSET = new Set(["CURRENT", "INVENTORY", "PREPAYMENT"]);
const FIXED = new Set(["FIXED", "NONCURRENT"]);
const WC_LIAB = new Set(["CURRLIAB", "PAYGLIABILITY", "SUPERANNUATIONLIABILITY"]);
const TERM = new Set(["TERMLIAB", "LIABILITY"]);
const FINANCING_CURRLIAB_CATEGORIES = new Set(["short_term_loans", "directors_loan"]);

export type CashFlowInput = {
  pl: Statement;
  open: Statement; // BS at prior FY end
  close: Statement; // BS at latest month end
  accounts: Map<string, AcctInfo>;
  period: { from: string; to: string };
};

export type CashFlowResult = Statement & {
  totals: { cfo: number; cfi: number; cff: number; net_change: number; delta_bank: number; check: number; tolerance: number };
  unclassified: { xeroAccountId: string; name: string; type: string }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function deriveCashFlow(i: CashFlowInput): CashFlowResult {
  const openBy = new Map(i.open.lines.filter((l) => l.xeroAccountId).map((l) => [l.xeroAccountId!, l]));
  const closeBy = new Map(i.close.lines.filter((l) => l.xeroAccountId).map((l) => [l.xeroAccountId!, l]));
  const ids = [...new Set([...openBy.keys(), ...closeBy.keys()])];

  const netProfit = i.pl.totals.net_profit ?? 0;
  const depreciation = r2(
    i.pl.lines.filter((l) => l.xeroAccountId && i.accounts.get(l.xeroAccountId)?.type === "DEPRECIATN").reduce((s, l) => s + l.value, 0),
  );
  const cyeOpen = i.open.totals.current_year_earnings ?? 0;

  const lines: StatementLine[] = [];
  let sort = 0;
  const push = (l: Omit<StatementLine, "sort">) => lines.push({ ...l, value: r2(l.value), sort: sort++ });

  push({ lineKey: "cf:net_profit", xeroAccountId: null, code: null, name: "Net profit", section: "operating", category: null, value: netProfit });
  push({ lineKey: "cf:depreciation", xeroAccountId: null, code: null, name: "Add back depreciation", section: "operating", category: "depreciation", value: depreciation });

  let dBank = 0;
  let dWcAssets = 0;
  let dWcLiabs = 0;
  let dFixed = 0;
  let financing = 0;
  const unclassified: CashFlowResult["unclassified"] = [];
  const financingLines: Omit<StatementLine, "sort">[] = [];

  for (const id of ids) {
    const a = i.accounts.get(id);
    const o = openBy.get(id)?.value ?? 0;
    const c = closeBy.get(id)?.value ?? 0;
    const d = r2(c - o);
    const ref = closeBy.get(id) ?? openBy.get(id)!;
    const type = (a?.type ?? "").toUpperCase();
    const base = { xeroAccountId: id, code: a?.code ?? ref.code, category: a?.category ?? null };
    const key = `cf:${a?.code || id}`;

    if (type === "BANK") {
      dBank += d;
    } else if (WC_ASSET.has(type)) {
      dWcAssets += d;
      if (d) push({ ...base, lineKey: key, name: `${d > 0 ? "Increase" : "Decrease"} in ${a!.name}`, section: "operating", value: -d });
    } else if (WC_LIAB.has(type) && !FINANCING_CURRLIAB_CATEGORIES.has(a?.category ?? "")) {
      dWcLiabs += d;
      if (d) push({ ...base, lineKey: key, name: `${d > 0 ? "Increase" : "Decrease"} in ${a!.name}`, section: "operating", value: d });
    } else if (FIXED.has(type)) {
      dFixed += d;
    } else if (WC_LIAB.has(type) || TERM.has(type)) {
      financing += d;
      if (d) financingLines.push({ ...base, lineKey: key, name: `${d > 0 ? "New borrowing" : "Repaid"}: ${a!.name}`, section: "financing", value: d });
    } else if (type === "EQUITY") {
      // The prior year's earnings roll into retained earnings at year end; that is not cash.
      const isRE = a?.systemAccount === "RETAINEDEARNINGS" || a?.category === "retained_earnings";
      const move = isRE ? r2(d - cyeOpen) : d;
      financing += move;
      if (move) financingLines.push({ ...base, lineKey: key, name: a!.name, section: "financing", value: move });
    } else if (d) {
      unclassified.push({ xeroAccountId: id, name: a?.name ?? ref.name, type: a?.type ?? "" });
    }
  }

  const cfo = r2(netProfit + depreciation - dWcAssets + dWcLiabs);
  const cfi = r2(-(dFixed + depreciation));
  const cff = r2(financing);
  if (cfi) push({ lineKey: "cf:capex", xeroAccountId: null, code: null, name: "Purchase of fixed assets (net)", section: "investing", category: "fixed_assets", value: cfi });
  for (const l of financingLines) push(l);

  const netChange = r2(cfo + cfi + cff);
  dBank = r2(dBank);
  const check = r2(netChange - dBank);
  const tolerance = Math.max(100, 0.005 * Math.abs(dBank));
  const reconciled = Math.abs(check) <= tolerance && unclassified.length === 0;

  return {
    kind: "cf",
    periodFrom: i.period.from,
    periodTo: i.period.to,
    derived: true,
    lines,
    totals: { cfo, cfi, cff, net_change: netChange, delta_bank: dBank, check, tolerance: r2(tolerance) },
    checks: reconciled ? [] : [`Cash flow doesn't reconcile yet: £${Math.abs(check).toFixed(2)} unexplained`],
    reconciled,
    reconDiff: check,
    unclassified,
  };
}
