/** Display helpers for the server-rendered pages. en-GB, pounds, London time. */
export const gbp = (n: number) => {
  const s = `£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
  return n < 0 ? `(${s})` : s;
};
export const pct = (share: number | null | undefined) =>
  share == null ? "" : share < 0.001 && share > 0 ? "<0.1%" : `${(share * 100).toFixed(1)}%`;
export const when = (d: Date | string) =>
  new Date(d).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });
export const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", dateStyle: "medium" });

export const STATE_LABEL: Record<string, string> = {
  flagged: "Look at this",
  covered: "Covered by an app you use",
  fine: "Fine",
  marked_fine: "You said no app is needed",
  snoozed: "Hidden for now (you said not now)",
  queued: "Being checked",
};
export const KIND_LABEL = { pl: "Profit and loss", bs: "Balance sheet", cf: "Cash flow" } as const;
export type Kind = keyof typeof KIND_LABEL;
export const isKind = (k: string): k is Kind => k in KIND_LABEL;
export const lineHref = (org: string, lineKey: string) => `/app/${org}/lines/${encodeURIComponent(lineKey)}`;
