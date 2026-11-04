/**
 * Builds fixtures/xero/demo-uk-synthetic/ — a SAMPLE company ("Copperpot Kitchens Ltd (sample)")
 * in Xero's exact JSON shapes. Numbers are constructed so the books balance and the derived
 * cash flow reconciles by identity. Replace with recorded Demo Company data via `pnpm xero:record`.
 *
 *   pnpm tsx scripts/make-synthetic.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const OUT = path.resolve("fixtures/xero/demo-uk-synthetic");
const CLOSE = "2026-10-31";
const OPEN = "2026-03-31";
const FY_FROM = "2026-04-01";

const uuid = (seed: string) => {
  const h = createHash("md5").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

type Acc = {
  code: string;
  name: string;
  type: string;
  cls: "REVENUE" | "EXPENSE" | "ASSET" | "LIABILITY" | "EQUITY";
  rc?: string;
  sys?: string;
  section: string; // report section title
  pl?: number; // YTD P&L amount (positive)
  open?: number; // BS balance at OPEN (sign as shown on BS)
  close?: number; // BS balance at CLOSE
};

const A: Acc[] = [
  // ---- P&L ----
  { code: "200", name: "Sales", type: "REVENUE", cls: "REVENUE", rc: "REV.TRA.GOO", section: "Income", pl: 2_554_000 },
  { code: "260", name: "Other Revenue", type: "REVENUE", cls: "REVENUE", rc: "REV.OTH", section: "Income", pl: 12_400 },
  { code: "310", name: "Cost of Goods Sold", type: "DIRECTCOSTS", cls: "EXPENSE", rc: "EXP.COS.PUR", section: "Less Cost of Sales", pl: 812_300 },
  { code: "400", name: "Advertising & Marketing", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.ADV", section: "Less Operating Expenses", pl: 31_500 },
  { code: "404", name: "Bank Fees", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.BAN", section: "Less Operating Expenses", pl: 6_200 },
  { code: "408", name: "Cleaning", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.CLE", section: "Less Operating Expenses", pl: 18_900 },
  { code: "412", name: "Consulting & Accounting", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.PRO", section: "Less Operating Expenses", pl: 24_000 },
  { code: "416", name: "Depreciation", type: "DEPRECIATN", cls: "EXPENSE", rc: "EXP.DEP", section: "Less Operating Expenses", pl: 42_000 },
  { code: "429", name: "General Expenses", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.GEN", section: "Less Operating Expenses", pl: 8_700 },
  { code: "433", name: "Insurance", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.INS", section: "Less Operating Expenses", pl: 15_400 },
  { code: "437", name: "Interest Paid", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.INT", section: "Less Operating Expenses", pl: 9_800 },
  { code: "445", name: "Light, Power, Heating", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.UTI", section: "Less Operating Expenses", pl: 54_300 },
  { code: "469", name: "Rent", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.REN", section: "Less Operating Expenses", pl: 168_000 },
  { code: "473", name: "Repairs and Maintenance", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.REP", section: "Less Operating Expenses", pl: 27_600 },
  { code: "477", name: "Wages and Salaries", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.EMP.WAG", section: "Less Operating Expenses", pl: 690_000 },
  { code: "478", name: "Employers National Insurance", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.EMP.NIC", section: "Less Operating Expenses", pl: 71_200 },
  { code: "479", name: "Employers Pensions", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.EMP.PEN", section: "Less Operating Expenses", pl: 20_700 },
  { code: "485", name: "Subscriptions", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.SUB", section: "Less Operating Expenses", pl: 14_900 },
  { code: "489", name: "Telephone & Internet", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.TEL", section: "Less Operating Expenses", pl: 5_100 },
  { code: "493", name: "Travel - National", type: "OVERHEADS", cls: "EXPENSE", rc: "EXP.TRA", section: "Less Operating Expenses", pl: 3_800 },
  { code: "500", name: "Corporation Tax", type: "EXPENSE", cls: "EXPENSE", rc: "EXP.TAX", section: "Less Operating Expenses", pl: 102_000 },
  // Deliberately ambiguous: no rule can map it confidently → review queue (M6 test).
  { code: "999", name: "Sundry adjustments", type: "EXPENSE", cls: "EXPENSE", section: "Less Operating Expenses", pl: 2_400 },
  // ---- Balance sheet ----
  { code: "090", name: "Business Bank Account", type: "BANK", cls: "ASSET", section: "Bank", open: 210_000 },
  { code: "091", name: "Business Savings Account", type: "BANK", cls: "ASSET", section: "Bank", open: 150_000, close: 150_000 },
  { code: "610", name: "Accounts Receivable", type: "CURRENT", cls: "ASSET", sys: "DEBTORS", rc: "ASS.CUR.REC.TRA", section: "Current Assets", open: 88_000, close: 121_500 },
  { code: "620", name: "Prepayments", type: "PREPAYMENT", cls: "ASSET", rc: "ASS.CUR.REC.PRE", section: "Current Assets", open: 14_000, close: 19_800 },
  { code: "630", name: "Inventory", type: "INVENTORY", cls: "ASSET", rc: "ASS.CUR.INY", section: "Current Assets", open: 46_000, close: 52_300 },
  { code: "710", name: "Kitchen Equipment", type: "FIXED", cls: "ASSET", rc: "ASS.NCA.FIX.PLA", section: "Fixed Assets", open: 380_000, close: 446_000 },
  { code: "711", name: "Less Accumulated Depreciation on Kitchen Equipment", type: "FIXED", cls: "ASSET", rc: "ASS.NCA.FIX.PLA.ACC", section: "Fixed Assets", open: -96_000, close: -138_000 },
  { code: "800", name: "Accounts Payable", type: "CURRLIAB", cls: "LIABILITY", sys: "CREDITORS", rc: "LIA.CUR.PAY.TRA", section: "Current Liabilities", open: 102_000, close: 131_400 },
  { code: "820", name: "VAT", type: "CURRLIAB", cls: "LIABILITY", sys: "GST", rc: "LIA.CUR.TAX.VAT", section: "Current Liabilities", open: 61_000, close: 73_900 },
  { code: "825", name: "PAYE & NI Payable", type: "CURRLIAB", cls: "LIABILITY", rc: "LIA.CUR.TAX.PAY", section: "Current Liabilities", open: 38_000, close: 41_200 },
  { code: "830", name: "Corporation Tax Payable", type: "CURRLIAB", cls: "LIABILITY", rc: "LIA.CUR.TAX.COR", section: "Current Liabilities", open: 88_000, close: 102_000 },
  { code: "835", name: "Accruals", type: "CURRLIAB", cls: "LIABILITY", rc: "LIA.CUR.ACC", section: "Current Liabilities", open: 22_000, close: 18_500 },
  { code: "840", name: "Short-term Loan", type: "CURRLIAB", cls: "LIABILITY", rc: "LIA.CUR.LOA", section: "Current Liabilities", open: 40_000, close: 25_000 },
  { code: "900", name: "Bank Loan", type: "TERMLIAB", cls: "LIABILITY", rc: "LIA.NCL.LOA", section: "Non-current Liabilities", open: 250_000, close: 220_000 },
  { code: "950", name: "Share Capital", type: "EQUITY", cls: "EQUITY", rc: "EQU.SHA", section: "Equity", open: 100, close: 100 },
  { code: "960", name: "Retained Earnings", type: "EQUITY", cls: "EQUITY", sys: "RETAINEDEARNINGS", rc: "EQU.RET", section: "Equity", open: 50_900 },
  { code: "970", name: "Dividends Paid", type: "EQUITY", cls: "EQUITY", rc: "EQU.DIV", section: "Equity", open: 0, close: -60_000 },
];

const by = (code: string) => A.find((a) => a.code === code)!;
const id = (a: Acc) => uuid(`account:${a.code}`);
const plAccs = A.filter((a) => a.pl !== undefined);
const revenue = plAccs.filter((a) => a.cls === "REVENUE").reduce((s, a) => s + a.pl!, 0);
const expenses = plAccs.filter((a) => a.cls === "EXPENSE").reduce((s, a) => s + a.pl!, 0);
const cogs = by("310").pl!;
const netProfit = revenue - expenses;
const CYE_OPEN = 140_000;

// Close balances that follow from the model.
by("960").close = by("960").open! + CYE_OPEN;
const equityClose = A.filter((a) => a.cls === "EQUITY").reduce((s, a) => s + a.close!, 0) + netProfit;
const liabClose = A.filter((a) => a.cls === "LIABILITY").reduce((s, a) => s + a.close!, 0);
const nonBankAssetsClose = A.filter((a) => a.cls === "ASSET" && a.code !== "090").reduce((s, a) => s + a.close!, 0);
by("090").close = round(equityClose + liabClose - nonBankAssetsClose);

function round(n: number) {
  return Math.round(n * 100) / 100;
}
const f = (n: number) => n.toFixed(2);
const attr = (a: Acc) => [{ Value: id(a), Id: "account" }];
const cell = (v: string, a?: Acc) => (a ? { Value: v, Attributes: attr(a) } : { Value: v });

// ---------- /Organisation ----------
const organisation = {
  Organisations: [
    {
      OrganisationID: uuid("org"),
      Name: "Copperpot Kitchens Ltd (sample)",
      BaseCurrency: "GBP",
      CountryCode: "GB",
      FinancialYearEndDay: 31,
      FinancialYearEndMonth: 3,
    },
  ],
};

// ---------- /Accounts ----------
const accounts = {
  Accounts: A.map((a) => ({
    AccountID: id(a),
    Code: a.code,
    Name: a.name,
    Type: a.type,
    Class: a.cls,
    Status: "ACTIVE",
    ...(a.rc ? { ReportingCode: a.rc } : {}),
    ...(a.sys ? { SystemAccount: a.sys } : {}),
  })),
};

// ---------- /Reports/ProfitAndLoss ----------
function plReport() {
  const sec = (title: string, accs: Acc[], total: string) => ({
    RowType: "Section",
    Title: title,
    Rows: [
      ...accs.map((a) => ({ RowType: "Row", Cells: [cell(a.name, a), cell(f(a.pl!), a)] })),
      { RowType: "SummaryRow", Cells: [cell(total), cell(f(accs.reduce((s, a) => s + a.pl!, 0)))] },
    ],
  });
  const income = plAccs.filter((a) => a.section === "Income");
  const cos = plAccs.filter((a) => a.section === "Less Cost of Sales");
  const opex = plAccs.filter((a) => a.section === "Less Operating Expenses");
  return {
    Reports: [
      {
        ReportID: "ProfitAndLoss",
        ReportName: "Profit and Loss",
        ReportType: "ProfitAndLoss",
        ReportTitles: ["Profit & Loss", organisation.Organisations[0]!.Name, "1 April 2026 to 31 October 2026"],
        ReportDate: "4 November 2026",
        Rows: [
          { RowType: "Header", Cells: [{ Value: "" }, { Value: "31 Oct 26" }] },
          sec("Income", income, "Total Income"),
          sec("Less Cost of Sales", cos, "Total Cost of Sales"),
          { RowType: "Section", Title: "", Rows: [{ RowType: "Row", Cells: [cell("Gross Profit"), cell(f(revenue - cogs))] }] },
          sec("Less Operating Expenses", opex, "Total Operating Expenses"),
          { RowType: "Section", Title: "", Rows: [{ RowType: "Row", Cells: [cell("Net Profit"), cell(f(netProfit))] }] },
        ],
      },
    ],
  };
}

// ---------- /Reports/BalanceSheet ----------
function bsReport(which: "open" | "close") {
  const val = (a: Acc) => (which === "open" ? a.open! : a.close!);
  const label = which === "open" ? "31 Mar 2026" : "31 Oct 2026";
  const sec = (title: string, total: string, extra: { label: string; v: number }[] = []) => {
    const accs = A.filter((a) => a.section === title && a.pl === undefined);
    const sum = accs.reduce((s, a) => s + val(a), 0) + extra.reduce((s, e) => s + e.v, 0);
    return {
      row: {
        RowType: "Section",
        Title: title,
        Rows: [
          ...accs.map((a) => ({ RowType: "Row", Cells: [cell(a.name, a), cell(f(val(a)), a)] })),
          ...extra.map((e) => ({ RowType: "Row", Cells: [cell(e.label), cell(f(e.v))] })),
          { RowType: "SummaryRow", Cells: [cell(total), cell(f(sum))] },
        ],
      },
      sum,
    };
  };
  const bank = sec("Bank", "Total Bank");
  const cur = sec("Current Assets", "Total Current Assets");
  const fix = sec("Fixed Assets", "Total Fixed Assets");
  const cl = sec("Current Liabilities", "Total Current Liabilities");
  const ncl = sec("Non-current Liabilities", "Total Non-current Liabilities");
  const cye = which === "open" ? CYE_OPEN : netProfit;
  const eq = sec("Equity", "Total Equity", [{ label: "Current Year Earnings", v: cye }]);
  const totalAssets = bank.sum + cur.sum + fix.sum;
  const totalLiab = cl.sum + ncl.sum;
  if (Math.abs(totalAssets - totalLiab - eq.sum) > 0.005) throw new Error(`BS ${which} does not balance`);
  const plain = (l: string, v: number) => ({ RowType: "Section", Title: "", Rows: [{ RowType: "Row", Cells: [cell(l), cell(f(v))] }] });
  return {
    Reports: [
      {
        ReportID: "BalanceSheet",
        ReportName: "Balance Sheet",
        ReportType: "BalanceSheet",
        ReportTitles: ["Balance Sheet", organisation.Organisations[0]!.Name, `As at ${label}`],
        ReportDate: "4 November 2026",
        Rows: [
          { RowType: "Header", Cells: [{ Value: "" }, { Value: label }] },
          { RowType: "Section", Title: "Assets", Rows: [] },
          bank.row,
          cur.row,
          fix.row,
          plain("Total Assets", totalAssets),
          { RowType: "Section", Title: "Liabilities", Rows: [] },
          cl.row,
          ncl.row,
          plain("Total Liabilities", totalLiab),
          plain("Net Assets", totalAssets - totalLiab),
          eq.row,
        ],
      },
    ],
  };
}

// ---------- /Reports/TrialBalance ----------
function tbReport() {
  // Debit-natured: expenses and assets. Credit-natured: revenue, liabilities, equity.
  const ytd = (a: Acc): { d: number; c: number } => {
    if (a.pl !== undefined) return a.cls === "REVENUE" ? { d: 0, c: a.pl } : { d: a.pl, c: 0 };
    const v = a.close!;
    if (a.cls === "ASSET") return v >= 0 ? { d: v, c: 0 } : { d: 0, c: -v };
    return v >= 0 ? { d: 0, c: v } : { d: -v, c: 0 };
  };
  const groups: [string, (a: Acc) => boolean][] = [
    ["Revenue", (a) => a.cls === "REVENUE"],
    ["Expenses", (a) => a.cls === "EXPENSE"],
    ["Assets", (a) => a.cls === "ASSET"],
    ["Liabilities", (a) => a.cls === "LIABILITY"],
    ["Equity", (a) => a.cls === "EQUITY"],
  ];
  let td = 0;
  let tc = 0;
  const sections = groups.map(([title, pred]) => ({
    RowType: "Section",
    Title: title,
    Rows: A.filter(pred).map((a) => {
      const { d, c } = ytd(a);
      td += d;
      tc += c;
      const md = a.pl !== undefined && d ? d / 7 : 0;
      const mc = a.pl !== undefined && c ? c / 7 : 0;
      const lab = `${a.name} (${a.code})`;
      return {
        RowType: "Row",
        Cells: [cell(lab, a), cell(md ? f(md) : "", a), cell(mc ? f(mc) : "", a), cell(d ? f(d) : "", a), cell(c ? f(c) : "", a)],
      };
    }),
  }));
  if (Math.abs(td - tc) > 0.005) throw new Error(`TB does not balance: ${td} vs ${tc}`);
  return {
    Reports: [
      {
        ReportID: "TrialBalance",
        ReportName: "Trial Balance",
        ReportType: "TrialBalance",
        ReportTitles: ["Trial Balance", organisation.Organisations[0]!.Name, "As at 31 October 2026"],
        ReportDate: "4 November 2026",
        Rows: [
          { RowType: "Header", Cells: [{ Value: "Account" }, { Value: "Debit" }, { Value: "Credit" }, { Value: "YTD Debit" }, { Value: "YTD Credit" }] },
          ...sections,
          { RowType: "Section", Title: "", Rows: [{ RowType: "SummaryRow", Cells: [cell("Total"), cell(""), cell(""), cell(f(td)), cell(f(tc))] }] },
        ],
      },
    ],
  };
}

// ---------- supplier spend (bills + card spend), Nov 2025 → Oct 2026 ----------
const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 10 + i, 15)));
const msDate = (d: Date) => `/Date(${d.getTime()}+0000)/`;
const contact = (name: string) => ({ ContactID: uuid(`contact:${name}`), Name: name });

type B = { name: string; amount: number; every?: number; from?: number; ccy?: string; rate?: number };
const billSpec: B[] = [
  { name: "Brakes Bros Ltd", amount: 61_200 },
  { name: "Bidfood UK Ltd", amount: 48_700 },
  { name: "Hollis Estates Ltd", amount: 72_000, every: 3 },
  { name: "British Gas Business", amount: 7_760 },
  { name: "Xero (UK) Ltd", amount: 59 },
  { name: "Dext Software Ltd", amount: 54 },
  { name: "Deputy", amount: 214.5 },
  { name: "Pleo Technologies ApS", amount: 105.3, ccy: "EUR", rate: 1.17 },
  { name: "Lightspeed (UK) Ltd", amount: 189 },
  { name: "Hiscox Insurance", amount: 2_200 },
];
const invoices = {
  Invoices: billSpec.flatMap((b) =>
    months
      .map((m, i) => ({ m, i }))
      .filter(({ i }) => i >= (b.from ?? 0) && i % (b.every ?? 1) === 0)
      .map(({ m, i }) => ({
        InvoiceID: uuid(`bill:${b.name}:${i}`),
        Type: "ACCPAY",
        Contact: contact(b.name),
        Date: msDate(m),
        DateString: m.toISOString().slice(0, 19),
        Status: i < 11 ? "PAID" : "AUTHORISED",
        Total: b.amount,
        CurrencyCode: b.ccy ?? "GBP",
        CurrencyRate: b.rate ?? 1,
      })),
  ),
};

type S = { name: string; amount: number; account: string; from?: number };
const spendSpec: S[] = [
  { name: "GOOGLE*GSUITE COPPERPOT", amount: 118.8, account: "485" },
  { name: "MSFT * E0300ABCD", amount: 96.4, account: "485" },
  { name: "Slack Technologies", amount: 64.0, account: "485" },
  { name: "Tillflow Ltd", amount: 79.0, account: "485", from: 6 }, // unknown software supplier → queue
  { name: "Fathum Ltd", amount: 45.0, account: "485", from: 8 }, // misspelt "Fathom": fuzzy 0.93–0.97 → fingerprint_check
  { name: "AMAZON MKTPLACE PMTS", amount: 212.37, account: "429" },
  { name: "EE Limited DD", amount: 410.0, account: "489" },
];
const banktransactions = {
  BankTransactions: spendSpec.flatMap((s) =>
    months
      .map((m, i) => ({ m, i }))
      .filter(({ i }) => i >= (s.from ?? 0))
      .map(({ m, i }) => ({
        BankTransactionID: uuid(`bank:${s.name}:${i}`),
        Type: "SPEND",
        Contact: contact(s.name),
        Date: msDate(m),
        Status: "AUTHORISED",
        Total: s.amount,
        CurrencyCode: "GBP",
        LineItems: [{ AccountCode: s.account, LineAmount: s.amount }],
      })),
  ),
};

const expected = {
  sample: true,
  note: "Totals this synthetic set was built to produce. Used by parser + statement tests.",
  period: { from: FY_FROM, to: CLOSE, open: OPEN },
  revenue,
  expenses,
  netProfit,
  grossProfit: revenue - cogs,
  bankOpen: by("090").open! + by("091").open!,
  bankClose: by("090").close! + by("091").close!,
};

fs.mkdirSync(OUT, { recursive: true });
const write = (name: string, obj: unknown) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + "\n");
write("organisation.json", organisation);
write("accounts.json", accounts);
write("pl.json", plReport());
write("bs-open.json", bsReport("open"));
write("bs-close.json", bsReport("close"));
write("tb.json", tbReport());
write("invoices.json", invoices);
write("banktransactions.json", banktransactions);
write("_expected.json", expected);
fs.writeFileSync(
  path.join(OUT, "README.md"),
  "# demo-uk-synthetic (SAMPLE)\n\nHand-built by `scripts/make-synthetic.ts` in Xero's JSON shapes. Not real data.\n" +
    "Replace with the real Demo Company via `pnpm xero:record` (writes `fixtures/xero/demo-uk/`).\n",
);
console.log(`wrote ${OUT}`, expected);
