/** The calls one refresh makes (BACKEND.md §3.4), validated with Zod at the boundary. */
import type { XeroClient } from "./client";
import { XeroHttpError } from "./client";
import {
  AccountsResponse,
  BankTransactionsResponse,
  InvoicesResponse,
  OrganisationResponse,
  type XeroAccount,
  type XeroOrganisation,
} from "./schemas";
import { parseReport, type ParsedReport } from "./parse-report";
import { z } from "zod";

export const iso = (d: Date) => d.toISOString().slice(0, 10);

function must(res: { status: number; json: unknown }, key: string) {
  if (res.status !== 200 || res.json === null) throw new XeroHttpError(res.status, key, "no data");
  return res.json;
}

export async function getOrganisation(c: XeroClient): Promise<XeroOrganisation> {
  const r = await c.get({ key: "organisation", path: "/Organisation" });
  return OrganisationResponse.parse(must(r, "organisation")).Organisations[0]!;
}

export async function getAccounts(c: XeroClient): Promise<XeroAccount[]> {
  const r = await c.get({ key: "accounts", path: "/Accounts" });
  return AccountsResponse.parse(must(r, "accounts")).Accounts;
}

export async function getProfitAndLoss(c: XeroClient, from: Date, to: Date): Promise<ParsedReport> {
  const r = await c.get({
    key: "pl",
    path: "/Reports/ProfitAndLoss",
    query: { fromDate: iso(from), toDate: iso(to), standardLayout: "true" },
  });
  return parseReport(must(r, "pl"));
}

export async function getBalanceSheet(c: XeroClient, date: Date, key: "bs-close" | "bs-open"): Promise<ParsedReport> {
  const r = await c.get({ key, path: "/Reports/BalanceSheet", query: { date: iso(date), standardLayout: "true" } });
  return parseReport(must(r, key));
}

/**
 * v1.1 B: 12 month-end balance sheets in one call (column 0 = `date`, then each month before it).
 * Returns null when the source has no such report (e.g. an older fixture set), so the caller can fall back.
 */
export async function getBalanceSheetMonthly(c: XeroClient, date: Date): Promise<ParsedReport | null> {
  const r = await c.get({ key: "bs-monthly", path: "/Reports/BalanceSheet", query: { date: iso(date), periods: "11", timeframe: "MONTH", standardLayout: "true" } });
  if (r.status === 404) return null;
  return parseReport(must(r, "bs-monthly"));
}

/** v1.1 B: 12 monthly P&L columns (column 0 = the month from..to, then the 11 months before). Null when unavailable. */
export async function getProfitAndLossMonthly(c: XeroClient, from: Date, to: Date): Promise<ParsedReport | null> {
  const r = await c.get({ key: "pl-monthly", path: "/Reports/ProfitAndLoss", query: { fromDate: iso(from), toDate: iso(to), periods: "11", timeframe: "MONTH", standardLayout: "true" } });
  if (r.status === 404) return null;
  return parseReport(must(r, "pl-monthly"));
}

/** One column of a multi-period report, as a single-period report (so the normal builders apply). */
export function columnOf(rep: ParsedReport, i: number): ParsedReport | null {
  if (rep.columns.length && i + 1 >= rep.columns.length) return null;
  return { ...rep, columns: rep.columns.length ? [rep.columns[0]!, rep.columns[i + 1]!] : rep.columns, rows: rep.rows.map((r) => ({ ...r, values: [r.values[i] ?? 0] })) };
}

export async function getTrialBalance(c: XeroClient, date: Date): Promise<ParsedReport> {
  const r = await c.get({ key: "tb", path: "/Reports/TrialBalance", query: { date: iso(date) } });
  return parseReport(must(r, "tb"));
}

const dt = (d: Date) => `DateTime(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
const PAGE_SIZE = 100;

export type Bill = z.infer<typeof InvoicesResponse>["Invoices"][number];
export type SpendTxn = z.infer<typeof BankTransactionsResponse>["BankTransactions"][number];

/** ACCPAY bills since `since`, summaryOnly, one page at a time. Rows are yielded, never stored. */
/** Bills that count as spend. The change check also asks for voided/deleted ones, so their month is rebuilt. */
export const SPEND_BILL_STATUSES = "AUTHORISED,PAID";
export const CHANGED_BILL_STATUSES = "AUTHORISED,PAID,VOIDED,DELETED";

export async function* bills(c: XeroClient, since: Date, ifModifiedSince?: Date, statuses = SPEND_BILL_STATUSES): AsyncGenerator<Bill[]> {
  for (let page = 1; ; page++) {
    const r = await c.get({
      key: "invoices",
      path: "/Invoices",
      page,
      ifModifiedSince,
      query: { where: `Type=="ACCPAY" AND Date>=${dt(since)}`, Statuses: statuses, summaryOnly: "true" },
    });
    if (r.notModified || (r.status === 404 && page > 1)) return;
    const list = InvoicesResponse.parse(must(r, "invoices")).Invoices;
    if (list.length) yield list;
    if (list.length < PAGE_SIZE) return;
  }
}

/** SPEND bank transactions since `since`, one page at a time. */
export async function* spendTransactions(c: XeroClient, since: Date, ifModifiedSince?: Date): AsyncGenerator<SpendTxn[]> {
  for (let page = 1; ; page++) {
    const r = await c.get({
      key: "banktransactions",
      path: "/BankTransactions",
      page,
      ifModifiedSince,
      query: { where: `Type=="SPEND" AND Date>=${dt(since)}` },
    });
    if (r.notModified || (r.status === 404 && page > 1)) return;
    const list = BankTransactionsResponse.parse(must(r, "banktransactions")).BankTransactions;
    if (list.length) yield list;
    if (list.length < PAGE_SIZE) return;
  }
}
