/**
 * FlowStack data model — BACKEND.md §12.
 * Every tenant table carries org_id and has RLS enabled (see db/migrations/*_rls.sql).
 * Catalogue tables are global and read-only to the app role.
 */
import {
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

// ---------- identity & tenancy ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  xeroUserId: text("xero_user_id"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("GBP"),
  country: text("country"),
  fyEndMonth: integer("fy_end_month").notNull().default(3),
  fyEndDay: integer("fy_end_day").notNull().default(31),
  industry: text("industry"),
  markets: text("markets").array().notNull().default(["UK"]),
  includeCurrentMonth: boolean("include_current_month").notNull().default(false),
  sample: boolean("sample").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull().default("owner"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const xeroConnections = pgTable("xero_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull().unique(),
  connectionId: text("connection_id"),
  /** One Xero authorisation can cover several tenants with a single rotating refresh token.
   *  Rows sharing a grant_key hold the same token set and are refreshed together under one lock. */
  grantKey: text("grant_key").notNull(),
  encAccess: bytea("enc_access"),
  encRefresh: bytea("enc_refresh"),
  expiresAt: ts("expires_at"),
  scopes: text("scopes").array().notNull().default([]),
  status: text("status", { enum: ["active", "revoked", "error"] }).notNull().default("active"),
  lastError: text("last_error"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------- sync ----------

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  status: text("status", { enum: ["running", "ok", "partial", "error"] }).notNull().default("running"),
  calls: integer("calls").notNull().default(0),
  egressBytes: integer("egress_bytes").notNull().default(0),
  steps: jsonb("steps").$type<RunStep[]>().notNull().default([]),
  error: text("error"),
}, (t) => [
  // One refresh at a time per org: a second concurrent run fails to insert (runRefresh → RefreshBusyError → 409).
  uniqueIndex("sync_runs_one_running").on(t.orgId).where(sql`status = 'running'`),
]);

export type RunStep = { key: string; status: "pending" | "running" | "ok" | "error"; calls?: number; bytes?: number; error?: string };

export const syncCursors = pgTable(
  "sync_cursors",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    modifiedSince: ts("modified_since"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.endpoint] })],
);

// ---------- chart of accounts & mapping ----------

export const accounts = pgTable(
  "accounts",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    xeroAccountId: uuid("xero_account_id").notNull(),
    code: text("code"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    class: text("class"),
    reportingCode: text("reporting_code"),
    systemAccount: text("system_account"),
    status: text("status"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.xeroAccountId] })],
);

export const accountMaps = pgTable(
  "account_maps",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    xeroAccountId: uuid("xero_account_id").notNull(),
    category: text("category").notNull(),
    confidence: real("confidence").notNull(),
    source: text("source", { enum: ["rule", "llm", "confirmed"] }).notNull(),
    ruleId: text("rule_id"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.xeroAccountId] })],
);

// ---------- statements ----------

export const statements = pgTable(
  "statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["pl", "bs", "cf"] }).notNull(),
    periodFrom: date("period_from"),
    periodTo: date("period_to").notNull(),
    derived: boolean("derived").notNull().default(false),
    reconciled: boolean("reconciled"),
    reconDiff: money("recon_diff"),
    totals: jsonb("totals").$type<Record<string, number>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("statements_org_kind").on(t.orgId, t.kind, t.createdAt)],
);

export const statementLines = pgTable(
  "statement_lines",
  {
    statementId: uuid("statement_id").notNull().references(() => statements.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    lineKey: text("line_key").notNull(),
    xeroAccountId: uuid("xero_account_id"),
    code: text("code"),
    name: text("name").notNull(),
    section: text("section").notNull(),
    category: text("category"),
    value: money("value").notNull(),
    sort: integer("sort").notNull(),
  },
  (t) => [primaryKey({ columns: [t.statementId, t.lineKey] })],
);

export const trialBalance = pgTable(
  "trial_balance",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
    xeroAccountId: uuid("xero_account_id").notNull(),
    code: text("code"),
    name: text("name").notNull(),
    ytdDebit: money("ytd_debit").notNull(),
    ytdCredit: money("ytd_credit").notNull(),
    asAt: date("as_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.xeroAccountId] })],
);

// ---------- apps in use (aggregates only — never row-level transactions) ----------

export const supplierSpend = pgTable(
  "supplier_spend",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    contactName: text("contact_name").notNull(),
    nameNorm: text("name_norm").notNull(),
    month: date("month").notNull(),
    amount: money("amount").notNull(),
    source: text("source", { enum: ["bill", "bank"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.contactId, t.month, t.source] })],
);

export const detectedApps = pgTable(
  "detected_apps",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    spend12m: money("spend_12m").notNull(),
    monthsSeen: integer("months_seen").notNull(),
    lastSeen: date("last_seen").notNull(),
    present: boolean("present").notNull(),
    evidence: jsonb("evidence").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.appId] })],
);

// ---------- flags & recommendations ----------

export const flags = pgTable(
  "flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
    statementKind: text("statement_kind", { enum: ["pl", "bs", "cf"] }).notNull(),
    lineKey: text("line_key").notNull(),
    xeroAccountId: uuid("xero_account_id"),
    ruleId: text("rule_id"),
    ruleVersion: integer("rule_version"),
    value: money("value").notNull(),
    base: money("base").notNull(),
    materiality: real("materiality").notNull(),
    band: text("band", { enum: ["high", "medium", "low"] }).notNull(),
    coverageGap: real("coverage_gap").notNull(),
    strength: real("strength").notNull(),
    state: text("state", { enum: ["flagged", "covered", "fine", "marked_fine", "queued"] }).notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("flags_org_run").on(t.orgId, t.runId),
    index("flags_org_line").on(t.orgId, t.lineKey),
    // One flag per line per run; recomputes update in place so flag ids (and feedback) survive.
    unique("flags_run_line").on(t.runId, t.lineKey),
  ],
);

export const recommendations = pgTable(
  "recommendations",
  {
    flagId: uuid("flag_id").notNull().references(() => flags.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    rank: integer("rank").notNull(),
    match: real("match").notNull(),
    components: jsonb("components").notNull(),
    inUse: boolean("in_use").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [primaryKey({ columns: [t.flagId, t.appId] })],
);

export const flagFeedback = pgTable("flag_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  flagId: uuid("flag_id").notNull().references(() => flags.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  userId: uuid("user_id"),
  lineKey: text("line_key").notNull(),
  ruleId: text("rule_id"),
  ruleVersion: integer("rule_version"),
  answer: text("answer", { enum: ["yes", "no"] }).notNull(),
  note: text("note"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const lineOverrides = pgTable(
  "line_overrides",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    lineKey: text("line_key").notNull(),
    ruleId: text("rule_id").notNull(),
    state: text("state", { enum: ["marked_fine"] }).notNull().default("marked_fine"),
    userId: uuid("user_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.lineKey, t.ruleId] })],
);

// ---------- catalogue (global) ----------

export const apps = pgTable("apps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  website: text("website"),
  categories: text("categories").array().notNull(),
  markets: text("markets").array().notNull(),
  crawl: jsonb("crawl"),
  sample: boolean("sample").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const fingerprints = pgTable(
  "fingerprints",
  {
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(),
    kind: text("kind", { enum: ["name", "alias"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.pattern] })],
);

export const integrations = pgTable(
  "integrations",
  {
    fromApp: text("from_app").notNull(),
    toApp: text("to_app").notNull(),
    kind: text("kind", { enum: ["native", "via_app", "csv"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromApp, t.toApp] })],
);

export const appFacts = pgTable(
  "app_facts",
  {
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    value: jsonb("value"),
    state: text("state", { enum: ["verified", "found", "missing", "conflicting", "stale"] }).notNull(),
    quote: text("quote"),
    sourceUrl: text("source_url"),
    checkedAt: ts("checked_at"),
    checkedBy: text("checked_by"),
    sample: boolean("sample").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.appId, t.field] })],
);

export const crawlPages = pgTable(
  "crawl_pages",
  {
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    url: text("url").notNull(),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
    status: text("status", { enum: ["ok", "blocked", "error"] }).notNull(),
    textHash: text("text_hash"),
    text: text("text"),
  },
  (t) => [primaryKey({ columns: [t.appId, t.kind] })],
);

// ---------- org extras ----------

export const orgEssentials = pgTable(
  "org_essentials",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    covered: boolean("covered").notNull().default(false),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

export const shortlist = pgTable(
  "shortlist",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    lineKey: text("line_key").notNull().default(""),
    addedBy: uuid("added_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.appId, t.lineKey] })],
);

/** A person accepted an unreconciled cash flow (BACKEND.md §9). Applies only while the difference is unchanged. */
export const cashflowAcceptances = pgTable(
  "cashflow_acceptances",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    periodTo: date("period_to").notNull(),
    diff: money("diff").notNull(),
    note: text("note").notNull(),
    acceptedBy: text("accepted_by").notNull(),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.periodTo] })],
);

// ---------- people-in-the-loop ----------

export const reviewQueue = pgTable(
  "review_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    ref: jsonb("ref").notNull(),
    refHash: text("ref_hash").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["open", "done", "dismissed"] }).notNull().default("open"),
    assignee: text("assignee"),
    resolution: jsonb("resolution"),
    createdAt: ts("created_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [unique("review_queue_kind_ref").on(t.kind, t.refHash), index("review_queue_open").on(t.status, t.createdAt)],
);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: jsonb("target").notNull(),
  at: ts("at").notNull().defaultNow(),
});

/** Tables that hold one org's data. RLS is enabled on each (see the rls migration). */
export const TENANT_TABLES = [
  "orgs",
  "org_members",
  "xero_connections",
  "sync_runs",
  "sync_cursors",
  "accounts",
  "account_maps",
  "statements",
  "statement_lines",
  "trial_balance",
  "supplier_spend",
  "detected_apps",
  "flags",
  "recommendations",
  "flag_feedback",
  "line_overrides",
  "org_essentials",
  "shortlist",
  "cashflow_acceptances",
] as const;
