/** Turn a stored fact value into plain words. Missing facts never reach here with a value. */
const MODEL: Record<string, string> = {
  flat_monthly: "Flat monthly fee",
  per_user: "Per user",
  per_employee: "Per employee",
  per_payslip: "Per payslip",
  per_seat: "Per seat",
  usage: "Usage based",
  quote: "Quote only",
};

export function factText(field: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "price_from_gbp" && typeof value === "number") return value === 0 ? "Free plan" : `From £${value % 1 ? value.toFixed(2) : value} a month`;
  if (field === "setup_fee" && typeof value === "number") return value === 0 ? "None" : `£${value}`;
  if (field === "price_model" && typeof value === "string") return MODEL[value] ?? value.replace(/_/g, " ");
  if ((field === "min_term" || field === "notice_period") && typeof value === "object" && value && "months" in value) {
    const m = Number((value as { months: number }).months);
    return m === 0 ? (field === "min_term" ? "None (cancel any time)" : "None") : `${m} month${m === 1 ? "" : "s"}`;
  }
  if (field === "days_to_go_live" && typeof value === "number") return `${value} days`;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).join(", ");
  return String(value);
}

export const FACT_GROUPS: { label: string; fields: string[] }[] = [
  { label: "Price", fields: ["price_from_gbp", "price_model", "setup_fee", "quote_only"] },
  { label: "Contract", fields: ["min_term", "notice_period", "auto_renew", "data_export"] },
  { label: "Fit with Xero", fields: ["posts_to_xero_as", "tracking_categories"] },
  { label: "Security", fields: ["security_certs", "data_location"] },
  { label: "Support and going live", fields: ["support_hours", "days_to_go_live"] },
];
