/**
 * One parser for every Xero report (BACKEND.md §3.6).
 * Reports[0].Rows[] nest Header | Section | Row | SummaryRow. The first cell of an account row
 * carries Attributes [{Id:"account", Value:<AccountID>}].
 */
import { ReportResponse, type XeroReport } from "./schemas";

export type ReportRow = {
  section: string;
  accountId: string | null;
  label: string;
  values: number[];
  /** SummaryRow, or a row with no account id (totals like "Gross Profit", "Total Assets", "Current Year Earnings"). */
  isSummary: boolean;
};

export type ParsedReport = { name: string; columns: string[]; rows: ReportRow[] };

/** "1,234.56" | "(1,234.56)" | "-1234.56" | "" → number. */
export function parseAmount(v: string | undefined): number {
  if (!v) return 0;
  const s = v.trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[(),£$\s]/g, ""));
  if (Number.isNaN(n)) return 0;
  return neg ? -n : n;
}

function accountIdOf(cells: { Attributes?: { Id: string; Value: string }[] }[] | undefined): string | null {
  for (const c of cells ?? []) {
    const a = c.Attributes?.find((x) => x.Id.toLowerCase() === "account");
    if (a) return a.Value;
  }
  return null;
}

export function parseReport(json: unknown): ParsedReport {
  const report: XeroReport = ReportResponse.parse(json).Reports[0]!;
  const rows: ReportRow[] = [];
  let columns: string[] = [];

  const walk = (list: XeroReport["Rows"], section: string) => {
    for (const r of list) {
      if (r.RowType === "Header") {
        columns = (r.Cells ?? []).map((c) => c.Value);
      } else if (r.RowType === "Section") {
        walk(r.Rows ?? [], r.Title ?? "");
      } else {
        const cells = r.Cells ?? [];
        const accountId = accountIdOf(cells);
        rows.push({
          section,
          accountId,
          label: cells[0]?.Value ?? "",
          values: cells.slice(1).map((c) => parseAmount(c.Value)),
          isSummary: r.RowType === "SummaryRow" || accountId === null,
        });
      }
    }
  };
  walk(report.Rows, "");
  return { name: report.ReportName, columns, rows };
}

/** Find a total row by label (case-insensitive), e.g. "Net Profit", "Total Assets". */
export function totalOf(p: ParsedReport, label: string, col = 0): number | null {
  const want = label.toLowerCase();
  const r = p.rows.find((x) => x.isSummary && x.label.trim().toLowerCase() === want);
  return r ? (r.values[col] ?? 0) : null;
}
