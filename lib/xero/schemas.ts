/**
 * Zod schemas for the Xero Accounting API responses we use (BACKEND.md §3.4).
 * Only the fields we read are declared; everything else is stripped.
 */
import { z } from "zod";

/** Xero list dates come as "/Date(1730419200000+0000)/"; also accept ISO strings. */
export const XeroDate = z.string().transform((s, ctx) => {
  const ms = s.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  const d = ms ? new Date(Number(ms[1])) : new Date(s);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: "custom", message: `Bad Xero date: ${s}` });
    return z.NEVER;
  }
  return d;
});

export const OrganisationResponse = z.object({
  Organisations: z
    .array(
      z.object({
        OrganisationID: z.string().optional(),
        Name: z.string(),
        BaseCurrency: z.string(),
        CountryCode: z.string().optional(),
        FinancialYearEndDay: z.number().int(),
        FinancialYearEndMonth: z.number().int(),
      }),
    )
    .min(1),
});
export type XeroOrganisation = z.infer<typeof OrganisationResponse>["Organisations"][number];

export const AccountsResponse = z.object({
  Accounts: z.array(
    z.object({
      AccountID: z.string().uuid(),
      Code: z.string().optional(),
      Name: z.string(),
      Type: z.string().optional().default(""),
      Class: z.string().optional(),
      ReportingCode: z.string().optional(),
      ReportingCodeName: z.string().optional(),
      TaxType: z.string().optional(),
      SystemAccount: z.string().optional(),
      Status: z.string().optional(),
    }),
  ),
});
export type XeroAccount = z.infer<typeof AccountsResponse>["Accounts"][number];

const Attribute = z.object({ Id: z.string(), Value: z.string() });
const Cell = z.object({ Value: z.string().optional().default(""), Attributes: z.array(Attribute).optional() });

type RowT = {
  RowType: "Header" | "Section" | "Row" | "SummaryRow";
  Title?: string;
  Cells?: z.infer<typeof Cell>[];
  Rows?: RowT[];
};
export const ReportRowSchema: z.ZodType<RowT> = z.lazy(() =>
  z.object({
    RowType: z.enum(["Header", "Section", "Row", "SummaryRow"]),
    Title: z.string().optional(),
    Cells: z.array(Cell).optional(),
    Rows: z.array(ReportRowSchema).optional(),
  }),
);

export const ReportResponse = z.object({
  Reports: z
    .array(
      z.object({
        ReportID: z.string().optional(),
        ReportName: z.string(),
        ReportDate: z.string().optional(),
        ReportTitles: z.array(z.string()).optional(),
        Rows: z.array(ReportRowSchema),
      }),
    )
    .min(1),
});
export type XeroReport = z.infer<typeof ReportResponse>["Reports"][number];

const Contact = z.object({ ContactID: z.string().uuid(), Name: z.string().optional().default("") });

export const InvoicesResponse = z.object({
  Invoices: z.array(
    z.object({
      InvoiceID: z.string(),
      Type: z.string(),
      Contact,
      Date: XeroDate,
      Status: z.string(),
      Total: z.number(),
      CurrencyCode: z.string().optional(),
      CurrencyRate: z.number().optional(),
    }),
  ),
});

export const BankTransactionsResponse = z.object({
  BankTransactions: z.array(
    z.object({
      BankTransactionID: z.string(),
      Type: z.string(),
      Contact: Contact.optional(),
      Date: XeroDate,
      Status: z.string().optional(),
      Total: z.number(),
      CurrencyCode: z.string().optional(),
      CurrencyRate: z.number().optional(),
      LineItems: z.array(z.object({ AccountCode: z.string().optional() })).optional().default([]),
    }),
  ),
});

export const ConnectionsResponse = z.array(
  z.object({
    id: z.string(),
    tenantId: z.string(),
    tenantType: z.string(),
    tenantName: z.string().nullable().optional(),
  }),
);

export const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});
export type TokenSet = z.infer<typeof TokenResponse>;
