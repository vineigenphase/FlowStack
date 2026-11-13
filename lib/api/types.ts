/**
 * FlowStack 1.0 API contract (UI-SPEC.md §8). The source of truth for the front end: import from here, never redefine.
 * Copied from UI-SPEC.md v1.0 (13 Nov 2026). Change the spec first, then this file.
 */
// ---------- primitives ----------
export type Money = number;                     // GBP, 2dp
export type ISODate = string;                   // "YYYY-MM-DD"
export type ISODateTime = string;
export type Band = "high" | "medium" | "low";
export type LineState = "flagged" | "covered" | "fine" | "marked_fine" | "queued" | "snoozed";
export type FactState = "verified" | "found" | "missing" | "conflicting" | "stale";
export type Lifecycle = "new" | "active" | "lapsing" | "inactive" | "declared";
export type Market = "UK" | "US" | "CA" | "AU";
export type Industry = "ecommerce" | "saas" | "other";
export type StatementKind = "pl" | "bs" | "cf";

export interface ApiError { code: ErrorCode; message: string; retryable: boolean; requestId: string }
export type ErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION"
  | "XERO_NOT_CONNECTED" | "XERO_RATE_LIMITED" | "XERO_CONNECTION_CAP" | "XERO_UNAVAILABLE"
  | "REFRESH_IN_PROGRESS" | "BILLING_REQUIRED" | "INTERNAL";

export interface Period { label: string; from: ISODate | null; to: ISODate }   // from null for "as at"
export interface FactValue<T> { value: T | null; state: FactState; source?: { url: string; checkedAt: ISODate }; quote?: string }

// ---------- me / orgs ----------
export interface Me {
  user: { id: string; email: string; name: string; jobTitle: string | null; isAdmin: boolean };
  orgs: OrgSummary[];
  activeOrgId: string | null;
}
export interface OrgSummary {
  id: string; name: string; industry: Industry | null; markets: Market[];
  lastRefreshAt: ISODateTime | null; atStake: Money | null;
  connection: "active" | "revoked" | "error"; sample: boolean;
}
export interface OrgSettings { markets: Market[]; industry: Industry | null; includeCurrentMonth: boolean; benchmarkOptIn: boolean; digestOptIn: boolean }

// ---------- refresh ----------
export interface RefreshRun {
  id: string; status: "running" | "ok" | "partial" | "error";
  startedAt: ISODateTime; finishedAt: ISODateTime | null;
  steps: { key: string; label: string; status: "pending" | "running" | "done" | "error"; detail?: string }[];
  error?: ApiError;
}

// ---------- overview ----------
export interface Summary {
  period: Period; atStake: Money; atStakeLabel: string;
  flaggedLines: number; totalLines: number; appsInUse: number; appsMatched: number;
  shortlistMonthly: Money | null; shortlistUnknownPrices: number;
  biggestLines: Line[];                 // max 5, flagged, by value desc
  trends: TrendSignal[];
  questions: LifecycleQuestion[];
  banners: Banner[];
  lastRefreshAt: ISODateTime | null; refreshing: boolean; sample: boolean;
}
export interface TrendSignal {
  key: "debtor_days" | "creditor_days" | "stock_days" | "cash_headroom_months";
  label: string; unit: "days" | "months";
  series: { month: ISODate; value: number }[];       // 12 month-ends
  latest: number; change3m: number; threshold: number;
  flagged: boolean; atStake: Money | null; band: Band | null; flagId: string | null; lineKey: string | null;
}
export interface Banner { kind: "connection_revoked" | "refresh_failed" | "cashflow_unreconciled" | "payment_failed" | "sample" | "connection_cap"; message: string; action?: { label: string; href: string } }

// ---------- statements ----------
export interface Statement {
  kind: StatementKind; label: string; period: Period;
  derived: boolean; reconciled: boolean | null; reconDiff: Money | null;
  base: { label: string; value: Money };
  months?: ISODate[];                    // present with ?months=12
  sections: { key: string; label: string; total: Money; lines: Line[] }[];
  sample: boolean;
}
export interface Line {
  key: string;                           // e.g. "pl:477", "trend:debtor_days"
  code: string | null; name: string; value: Money;
  monthly?: Money[];                     // aligned to Statement.months
  share: number | null;                  // 0–1
  band: Band | null; state: LineState; flagId: string | null;
  topApp: { id: string; name: string; match: number } | null;
  coveredBy: { id: string; name: string } | null;
  oneOffNote: string | null; snoozedUntil: ISODate | null;
}

// ---------- line detail ----------
export interface LineDetail {
  line: Line; statementKind: StatementKind | "trend";
  evidence: {
    trialBalance: { code: string; name: string; ytdNet: Money; asAt: ISODate } | null;
    statementValue: Money; base: { label: string; value: Money };
    materiality: number; band: Band | null;
    ruleId: string | null; ruleVersion: number | null; runId: string; refreshedAt: ISODateTime;
    series?: { month: ISODate; value: number }[];
  };
  cause: string | null;
  detectedInArea: DetectedApp[];
  recommendations: Recommendation[];
  feedback: Feedback | null;
}
export interface Recommendation {
  rank: number; app: AppCard; match: number;        // 0–100
  components: { strength: number; fit: number; peers: number; price: number };  // each 0–1
  weights: { strength: number; fit: number; peers: number; price: number };     // 0.50 / 0.35 / 0.10 / 0.05
  reason: string; inUse: boolean;
  kind: "add" | "change" | null;                   // null = the app already in use (deviation from UI-SPEC v1.0, NOTES.md)
}
export interface AppCard {
  id: string; name: string; categories: string[]; markets: Market[];
  price: FactValue<{ model: "per_month" | "per_user_month" | "per_year" | "quote" | "usage"; fromGbp: number | null; note?: string }>;
  sample: boolean;
}

// ---------- feedback ----------
export type FeedbackAnswer = "yes" | "already_use_app" | "no_app_needed" | "numbers_wrong" | "not_now";
export type SubReason = "wrong_category" | "figure_mismatch" | "one_off" | "miscoded";
export interface FeedbackInput { answer: FeedbackAnswer; subReason?: SubReason; appId?: string; appName?: string; note?: string }
export interface Feedback extends FeedbackInput { id: string; createdAt: ISODateTime; by: string }
export interface FeedbackResult { feedback: Feedback; line: Line; message: string }

// ---------- apps ----------
export interface DetectedApp {
  appId: string; name: string; category: string; spend12m: Money; monthsSeen: number;
  lastPaid: ISODate | null; cycle: "monthly" | "quarterly" | "annual" | "unknown"; state: Lifecycle;
}
export interface LifecycleQuestion {
  id: string; kind: "lapsing" | "replacement";
  appId: string; appName: string; lastPaid: ISODate | null;
  replacementAppId?: string; replacementAppName?: string;
}
export interface LifecycleAnswer { answer: "still_using" | "moved_to" | "stopped" | "is_replacement" | "not_replacement"; movedToAppId?: string; movedToName?: string }
export interface AppDossier {
  app: { id: string; name: string; website: string; categories: string[]; markets: Market[]; sample: boolean };
  facts: Record<string, FactValue<unknown> & { group: "price" | "contract" | "fit" | "going_live" | "security" | "support" | "vendor"; label: string }>;
  integrations: { toAppId: string; toName: string; kind: "native" | "via_app" | "csv"; usedByOrg: boolean }[];
}

// ---------- essentials / shortlist ----------
export interface Essential { key: string; name: string; frequency: "monthly" | "quarterly" | "yearly"; nextDue: ISODate | null; suggested: { appId: string | null; label: string }; covered: boolean }
export interface ShortlistItem { appId: string; appName: string; lineKey: string | null; lineName: string | null; price: AppCard["price"]; addedAt: ISODateTime }

// ---------- billing ----------
export interface Plan { id: "monthly" | "annual" | "audit_only"; label: string; priceGbp: number | null; interval: "month" | "year" | "one_off"; auditIncluded: boolean; auditPriceGbp: number | null; available: boolean; highlight: boolean }
export interface Subscription { status: "none" | "active" | "past_due" | "cancelled" | "design_partner"; planId: Plan["id"] | null; currentPeriodEnd: ISODate | null; cancelAtPeriodEnd: boolean }
