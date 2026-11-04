# BACKEND.md — FlowStack backend 1.0 (dev mode first)

> Build spec for Claude Code. Read it end to end before writing code, then build the milestones in §14 in order.
> **Where this file conflicts with CLAUDE.md §3, §6 or §7, this file wins for release 1.0.** Everything else in CLAUDE.md still applies: read-only, no AI training on Xero data, tenant isolation, sample data labelled, no scraping of competitors.
> Written 4 Nov 2026. Re-check the Xero facts in §3 against developer.xero.com before you rely on them.

---

## 0. The goal in one paragraph

A finance director connects Xero (read-only). FlowStack pulls a handful of **reports**, builds the P&L (year to date), balance sheet (latest month end) and cash flow (year to date), and maps every account to a standard category. Then it flags each line that is **material** and has **no app covering it**, with the trial balance figure as evidence. It ranks apps for that line, including the app the business already uses. Anything the system is unsure about goes to a **review queue** for a person. Nothing is ever estimated or made up. The metric we run on is the **false-positive rate**: flags users mark "Not a problem" ÷ flags they answered.

**Dev mode** means the whole backend runs locally against Xero's free Starter plan and the Demo Company, or with no Xero at all from recorded fixtures (`XERO_MODE=fixtures`). The same code deploys to Vercel + Neon with no changes.

---

## 1. Decisions that shape the build

| # | Decision | Why |
|---|---|---|
| D1 | **Reports first, not a transaction sync.** P&L, BalanceSheet and TrialBalance from the Accounting API | A few calls per business, low data cost, fast first load, easier trust story |
| D2 | **The cash flow statement is derived** (indirect method) from two balance sheets + P&L, and must reconcile to the bank movement | Xero's Finance API has a cash flow endpoint, but its scope is restricted to financial institutions (§3.3). The Accounting API has no cash flow report |
| D3 | **Apps in use come from supplier spend**: bills (`Invoices`, `summaryOnly=true`) + spend bank transactions, **aggregated per supplier per month, then the rows are discarded** | Finance API "expense by contacts" is restricted too. We store aggregates only, never individual transactions |
| D4 | **Signal strength = coverage gap × materiality.** Rank lines by £ value | "The cost of getting it wrong" |
| D5 | **No guessing.** Every catalogue fact has a state (`verified / found / missing / conflicting / stale`). Missing goes to the review queue and shows as "Not published · we're checking" | Trust; avoids false positives |
| D6 | **False-positive rate is the release gate.** Labelled test set + "Is this right?" feedback on every flag | Main product risk |
| D7 | **Hours saved is out of 1.0.** It needs volumes, which only transactions give | Honesty. Volumes come back in 2.0 |
| D8 | **Markets are chosen at set-up in 1.0** (UK, US, CA, AU). Auto-detected in 2.0 | Simple, correct |
| D9 | **The LLM is optional and never sees amounts.** Rules work alone (`LLM_ENABLED=false`) | Xero terms (no training); keeps dev mode free |
| D10 | **Jobs run inline in dev mode.** A refresh is ~10–25 calls and finishes in seconds. Inngest is added in milestone M9 | Ship sooner |

---

## 2. Stack

- **Runtime:** Node 20+, pnpm, TypeScript `strict`.
- **App/API:** Next.js (App Router), route handlers under `/app/api/**`. The backend can ship before any UI; the existing `flowstack-ledger.html` gets wired to these endpoints later.
- **DB:** Postgres 16. Local: Docker. Cloud: Neon. **Drizzle ORM** + drizzle-kit migrations in `/db/migrations`.
- **Validation:** Zod at every boundary (Xero responses, request bodies, LLM output, YAML catalogue).
- **Xero:** plain `fetch` wrapper in `/lib/xero` (full control over rate limits, egress metering and fixtures). `xero-node` may be used for types only.
- **Auth:** "Sign in with Xero" via the same OAuth (OIDC `id_token` verified with `jose` against Xero's JWKS), session in an `iron-session` cookie. Admins are listed in `ADMIN_EMAILS`.
- **Crypto:** `libsodium-wrappers` secretbox for tokens. Key from `TOKEN_ENC_KEY` (32 bytes, base64).
- **LLM (optional):** `@anthropic-ai/sdk`. `claude-haiku-5-5` for fact extraction and account-name suggestions. Inference only.
- **Crawl (optional):** Tavily Extract (`TAVILY_API_KEY`), falling back to plain `fetch` + `@mozilla/readability`.
- **Logs:** pino with redaction (`*.access_token`, `*.refresh_token`, `*.id_token`, `report`, `rows`). Sentry when `SENTRY_DSN` is set.
- **Tests:** vitest. Playwright later.

---

## 3. Xero: what we use and how

### 3.1 App and plan
- **Starter plan (free):** 5 connections, 1,000 API calls/day per org, no payment method needed. Use it for dev and the first design partners. Move to **Core** ($35 AUD/month, 50 connections, 10 GB egress, 5,000 calls/day per org) before connection 6.
- Excluded from Starter and Core: Journals endpoint, Bulk Connections, Rapid Sync, App Store listing. We depend on none of them.
- Limits to respect: **60 calls/minute per org**, **5 concurrent calls per org**, plus the daily limit. Response headers `X-DayLimit-Remaining`, `X-MinLimit-Remaining` and `X-AppMinLimit-Remaining` are read on every call. On 429, honour `Retry-After`.

### 3.2 Scopes (granular, mandatory for apps created after 2 March 2026)
```
openid profile email offline_access
accounting.settings.read            # Organisation, Accounts, TrackingCategories
accounting.contacts.read            # supplier names/addresses
accounting.reports.profitandloss.read
accounting.reports.balancesheet.read
accounting.reports.trialbalance.read
accounting.reports.aged.read        # aged payables/receivables (2.0 KPIs, detection backup)
accounting.invoices.read            # bills summary for apps-in-use (D3)
accounting.banktransactions.read    # card/direct-debit spend for apps-in-use (D3)
```
Nothing with write. Before creating the app, check the names against Xero's scopes page. Broad scopes (`accounting.transactions`, `accounting.reports.read`) are **not available** to new apps.

### 3.3 Finance API: not available to us
`finance.statements.read` (FinancialStatements: ProfitAndLoss, BalanceSheet, **Cashflow**, TrialBalance, contacts/expense, contacts/revenue) is a restricted scope for financial institutions (banks, card providers, lenders). Requesting it returns "Invalid scope for client". **Do not build on it.** Keep an interface seam (`StatementsSource`) so a Finance API source can be added if Xero ever grants access, for example as part of the 4.0 funding work.

### 3.4 Endpoints per refresh (Accounting API, base `https://api.xero.com/api.xro/2.0`)
Every call sends the header `xero-tenant-id`.

| # | Call | Params | Use |
|---|---|---|---|
| 1 | `GET /Organisation` | – | base currency, country, financial year end, org name |
| 2 | `GET /Accounts` | – | codes, names, `Type`, `Class`, `ReportingCode`, `SystemAccount` → mapping |
| 3 | `GET /Reports/ProfitAndLoss` | `fromDate`=FY start, `toDate`=latest month end, `standardLayout=true` | P&L YTD; revenue = materiality base |
| 4 | `GET /Reports/BalanceSheet` | `date`=latest month end, `standardLayout=true` | BS; total assets = base |
| 5 | `GET /Reports/BalanceSheet` | `date`=prior FY end, `standardLayout=true` | opening balances for derived cash flow |
| 6 | `GET /Reports/TrialBalance` | `date`=latest month end | evidence on every flag |
| 7+ | `GET /Invoices` | `where=Type=="ACCPAY" AND Date>=DateTime(y,m,d)`, `Statuses=AUTHORISED,PAID`, `summaryOnly=true`, `page=n` | supplier spend (aggregate, discard) |
| 8+ | `GET /BankTransactions` | `where=Type=="SPEND" AND Date>=DateTime(y,m,d)`, `page=n` | card/DD spend (aggregate, discard) |
| later | `GET /TrackingCategories`, `/Reports/ProfitAndLoss?trackingCategoryID=` | – | 2.0 sites / revenue centres |

- "Latest month end" = the last day of the previous calendar month. Use the current month only if the user picks "include this month".
- On re-runs, send `If-Modified-Since` on Invoices and BankTransactions (cursor in `sync_cursors`). Reports are always fetched fresh; they are small.
- Typical refresh is 8–25 calls. Meter bytes per call into `sync_runs.egress_bytes`.

### 3.5 OAuth (authorisation code + PKCE)
- Authorise: `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=…&redirect_uri=…&scope=…&state=…&code_challenge=…&code_challenge_method=S256`
- Token: `POST https://identity.xero.com/connect/token` (Basic auth with client id/secret)
- Tenants: `GET https://api.xero.com/connections` → one row per org the user authorised
- Revoke: `POST https://identity.xero.com/connect/revocation`; disconnect a tenant: `DELETE https://api.xero.com/connections/{connectionId}`
- Access token lasts ~30 minutes. The refresh token rotates on every use; store the new one atomically. Refresh under a **Postgres advisory lock per connection** (`pg_advisory_xact_lock(hashtext(connection_id))`) so two requests never both spend the same refresh token.
- Verify `id_token` with `jose` against JWKS `https://identity.xero.com/.well-known/openid-configuration/jwks`.

### 3.6 Parsing Xero reports
Reports come back as `Reports[0].Rows[]` with `RowType` ∈ `Header | Section | Row | SummaryRow`. Each `Row.Cells[]` has `Value`, and the first cell's `Attributes[]` carries `{Id:"account", Value:<AccountID UUID>}`. Write one parser, `parseReport(json) → ReportRow[]`:
```ts
type ReportRow = { section: string; accountId: string | null; label: string; values: number[]; isSummary: boolean };
```
- Join to `/Accounts` on `AccountID` to get the code and type. Rows without an account id are totals; keep them for checks.
- Trial balance columns are Debit, Credit, YTD Debit, YTD Credit. Store `ytd_net = ytdDebit − ytdCredit` (sign by account class).
- **Unit test the parser against real Demo Company JSON** recorded into `/fixtures/xero/demo-uk/`.

---

## 4. Derived cash flow (indirect method)

Inputs: P&L YTD, BS at prior FY end (`open`) and latest month end (`close`), account types from `/Accounts`.
```
net_profit        = P&L net profit YTD
depreciation      = Σ P&L lines with Type = DEPRECIATN
Δwc_assets        = Σ (close − open) for CURRENT, INVENTORY, PREPAYMENT (exclude BANK)
Δwc_liabs         = Σ (close − open) for CURRLIAB (exclude accounts mapped to "short-term loans")
CFO = net_profit + depreciation − Δwc_assets + Δwc_liabs
CFI = −( Δ FIXED (net book value) + depreciation )          # capex
CFF = Δ TERMLIAB + Δ short-term loans + Δ EQUITY (excluding current-year earnings and retained earnings roll)
check = CFO + CFI + CFF − Δ BANK
```
- If `|check| ≤ max(£100, 0.5% of |Δ BANK|)`, the statement is `reconciled`.
- Otherwise, show the statement as "Cash flow doesn't reconcile yet: £X unexplained", open a review-queue item (`kind=cashflow_unreconciled`), and **do not flag cash flow lines** for that org until it is resolved.
- Label the statement "Cash flow (derived from your balance sheet)" in the API payload.
- Tests: hand-built fixture where the answer is known; Demo Company; a fixture with a missing account type that must fail the reconciliation and open a queue item.

---

## 5. Account mapping

Each Xero account gets an **account category** (about 40, in `catalog/account-categories.yaml`). Signals work off categories, never raw codes.

The pipeline, in order, stopping at the first confident match:
1. **Confirmed map** from a previous user or admin answer (`account_maps.source = confirmed`), confidence 1.0.
2. **Rules:** `Type` + `ReportingCode` (UK reporting codes are rich, e.g. wages vs. rent) + code range + name keywords. Confidence from the rule (0.7–0.95).
3. **LLM suggestion** (only if `LLM_ENABLED`): send **account names and types only, no amounts, no org name**. The response must be JSON `{category, confidence}` validated by Zod. Capped at 0.8.
4. Below `MAP_CONFIDENCE_MIN` (default 0.75): category `unmapped`, open a review-queue item `kind=account_mapping`. **Lines on unmapped accounts are never flagged.**

```yaml
# catalog/account-categories.yaml (excerpt)
- key: wages
  label: Wages and salaries
  statement: pl
  match:
    types: [EXPENSE, OVERHEADS, DIRECTCOSTS]
    reporting_codes: [EXP.EMP.WAG, EXP.EMP]      # verify against Demo Company accounts
    name_any: [wage, salar, payroll, staff cost]
- key: rent
  label: Rent and rates
  statement: pl
  match: { types: [OVERHEADS, EXPENSE], name_any: [rent, rates, lease] }
- key: trade_debtors
  label: Money owed by customers
  statement: bs
  match: { types: [CURRENT], system_account: DEBTORS }
```

---

## 6. Apps in use (detection)

1. Pull ACCPAY bills (`summaryOnly=true`) and SPEND bank transactions for the last 12 months (§3.4).
2. **In memory**, group by `ContactID` + month → `{contact_id, contact_name, month, amount_base_ccy, source}`. Write only these aggregates to `supplier_spend`. **Never persist the individual rows.**
3. Normalise names: lowercase; strip `ltd limited inc llc plc pty gmbh uk`, punctuation, `*`, `dd`, trailing reference numbers.
4. Match against `fingerprints` (in `catalog/apps.yaml`): exact → alias → fuzzy (Jaro-Winkler ≥ 0.93). Fuzzy matches below 0.97 open a queue item `kind=fingerprint_check` instead of counting as detected.
5. Suppliers in "software / subscriptions" account categories that match nothing open a queue item `kind=unknown_supplier`, so the fingerprint list grows.
6. `detected_apps` rows: `app_id, spend_12m, months_seen, last_seen, evidence {contact names, sources}`. **Present** = paid in ≥2 of the last 4 months.

---

## 7. Flags (signals)

### 7.1 Rules
`catalog/rules.yaml` maps account categories to the app categories that can help. Thresholds live here, not in code.
```yaml
- id: payroll_no_bridge
  account_categories: [wages, employer_ni, pensions]
  app_categories: [payroll, rota]
  min_value_gbp: 1000          # low threshold is fine; materiality decides the rank
  cause: "Payroll costs this size usually need a payroll app posting to Xero. Only your team can confirm how it's done today."
- id: rent_fine
  account_categories: [rent, depreciation, interest, corporation_tax, bank_charges]
  app_categories: []           # "Fine as is": no app category applies
```

### 7.2 Computation (pure function, `lib/signals/compute.ts`)
```
base         = revenue YTD (P&L and cash flow lines) | total assets (BS lines)
materiality  = |value| / base
band         = high if ≥ HIGH_BAND (0.10) | medium if ≥ MED_BAND (0.02) | low otherwise
coverage_gap = 1    if no detected app sits in any of the rule's app categories
             = 0.5  if one does, but a different app outranks it (computed after scoring, §8)
             = 0    if the top-ranked app is already in use  → state "covered"
strength     = coverage_gap × materiality
```

Line states:

| State | When |
|---|---|
| `flagged` | the rule has app categories, value ≥ min, gap > 0, mapping is confident |
| `covered` | gap = 0; show "Covered · <app>" |
| `fine` | the rule has no app categories, or no rule applies |
| `marked_fine` | the user answered "Not a problem" (persisted per org + line + rule) |
| `queued` | the mapping is unsure or cash flow is unreconciled; the line shows as "Checking" |

- **Order:** flagged lines by `|value|` descending (the £ value is the cost of getting it wrong), then covered, then fine.
- **Hero number "£ at stake":** Σ |value| of `flagged` P&L cost lines (exclude revenue categories).
- **Evidence (every flag):**
  ```
  { trial_balance: {code, name, ytd_net, as_at},
    statement_value, base_label, base_value, materiality,
    detected_in_area: [{app, spend_12m, months_seen}],
    rule_id, rule_version }
  ```

---

## 8. Catalogue and scoring

### 8.1 Catalogue files (hand-curated, reviewed in PRs; each fact carries a source)
- `catalog/app-categories.yaml`: management reporting, consolidation, data capture, spend & payables, billing & receivables, payroll, rota, FX & global banking, inventory, job & project management, FP&A, cash flow forecasting, EPOS / ecommerce sales, compliance. Mayday's public grouping is the reference, typed by hand. **No scraping.**
- `catalog/apps.yaml`: one entry per app.
  ```yaml
  - id: staffology
    name: Staffology Payroll
    categories: [payroll]
    markets: [UK]
    website: https://www.staffology.co.uk
    crawl: { home: /, pricing: /pricing, product: /payroll, services: null }
    fingerprints: [staffology, iris staffology]
    integrations: [{ to: deputy, kind: native }, { to: xero, kind: native }]
    sample: true          # until a person verifies the facts
  ```
- `catalog/markets.yaml`: per-market requirements and swaps (e.g. UK payroll → US: Gusto).
- `catalog/essentials.yaml`: every-year items per market. UK: VAT returns (quarterly, Xero MTD), confirmation statement (yearly, Companies House £50), month-end close calendar (monthly, Easy Month End).

### 8.2 Facts with states (`app_facts`)
Fields per app: `price_model, price_from_gbp, setup_fee, quote_only, min_term, notice_period, auto_renew, data_export, posts_to_xero_as, tracking_categories, security_certs, data_location, support_hours, days_to_go_live`.
Each row: `value, state, quote, source_url, checked_at, checked_by, sample`.

| state | set by | shown as |
|---|---|---|
| verified | a person (admin) | value + source + date |
| found | crawler, with a verified quote | value, "from the vendor's site" |
| missing | crawler found nothing | "Not published · we're checking" + queue item |
| conflicting | two pages disagree, or the value moved >30% | last verified value + queue item |
| stale | not confirmed in 90 days | value + age + queue item |

**Sample data rule:** seeded facts carry `sample: true`, and the API returns `"sample": true` so the UI labels them.

### 8.3 Scoring (`lib/rank/score.ts`)
For each flagged line, candidates = apps in the rule's app categories, filtered by the org's markets. **Include the detected app even if it would not otherwise qualify.**
```
match = 100 × ( 0.40 × strength_norm          # strength ÷ max strength across this org's flags
              + 0.25 × fit_with_in_use        # native integration with an app they keep 1.0 | via app 0.8 | CSV 0.6 | none 0.3 | no apps to fit 0.5
              + 0.20 × peer_results           # 0.5 neutral until 3.0 feedback exists
              + 0.15 × price_fit )            # band vs revenue band; 0.5 neutral when price is missing (never estimated)
```
- Return the top 3 plus the in-use app if it isn't in the top 3. Each comes with `components` and a one-line `reason`.
- An in-use app ranked first → line becomes `covered`. An in-use app ranked lower → gap 0.5, and both are shown (e.g. Pleo vs Ramp).
- Priority presets (Balanced, Lowest cost, Fastest live, Best support) from CLAUDE.md §7.3b come later. Keep the weights in `catalog/rules.yaml → scoring:`.

---

## 9. Review queue (no guessing)

The `review_queue` table is the single inbox for people (Vinu and Luke).

| kind | created when | resolution |
|---|---|---|
| `account_mapping` | mapping confidence below the bar | pick a category → writes `account_maps` (confirmed) → recompute the org |
| `fingerprint_check` | fuzzy supplier match | confirm (adds alias) or reject |
| `unknown_supplier` | software-looking supplier, no match | add app/fingerprint or dismiss |
| `fact_missing` / `fact_conflicting` / `fact_stale` | crawl results | enter verified value + source, or confirm missing |
| `fact_spot_check` | random 20% of changed `found` facts | verify or correct |
| `cashflow_unreconciled` | §4 check fails | fix the account mapping or accept with a note |
| `flag_disputed` | user answers "Not a problem" | tune the rule, or note why the flag stands |

Rules:
- Items dedupe on `(kind, ref_hash)`.
- Resolving writes an `audit_log` row.
- The admin API lists open items, oldest first, filterable by kind.

---

## 10. False positives

- `POST /api/flags/:id/feedback {answer: "yes" | "no", note?}`. "no" sets the line `marked_fine` for that org and opens `flag_disputed`.
- FP rate = `count(no) / count(answered)` overall, per rule, and per week: `GET /api/admin/fp-report`.
- **Labelled test set:** `/fixtures/labelled/<org>.json` holds a chart of accounts + report fixtures + the expected state for every line, labelled by us. `pnpm eval` runs the full pipeline on each and prints FP rate and missed-flag rate per rule. **CI fails if the FP rate is above `FP_GATE` (0.15 for 1.0).**
- Every flag stores `rule_id` + `rule_version`, so rate changes can be traced to rule edits.

---

## 11. Crawl (monthly, `pnpm crawl` / cron)

For each app in `apps.yaml`:
1. Fetch the 4 pages (home, services, pricing, product) via Tavily Extract. If there is no key, use `fetch` + Readability. Respect `robots.txt`; skip disallowed pages and record `blocked`.
2. Store page text + hash in `crawl_pages`. Unchanged hash → skip extraction.
3. Extraction (`claude-haiku-5-5`, if enabled) returns JSON `[{field, value, quote}]`, validated by Zod.
4. **Quote check:** keep a fact only if `quote` appears verbatim in the normalised page text (whitespace and case folded). No quote match, no fact.
5. Compare with the current fact. New or changed → `found` (+20% sampled to `fact_spot_check`). Fields not found anywhere → `missing` + queue. Disagreement between pages → `conflicting` + queue.
6. Facts not confirmed for 90 days → `stale` (nightly job).
7. **Never auto-promote to `verified`.**

---

## 12. Data model (Drizzle, `/db/schema.ts`)

All tenant tables have `org_id` and **RLS on**.

```ts
users(id uuid pk, email text unique, name text, xero_user_id text, is_admin bool, created_at)
orgs(id uuid pk, name, base_currency, country, fy_end_month int, fy_end_day int, industry text null,
     markets text[] default '{UK}', created_at)
org_members(org_id, user_id, role: 'owner'|'member', pk(org_id,user_id))
xero_connections(id uuid pk, org_id, tenant_id text unique, connection_id text, enc_access bytea, enc_refresh bytea,
                 expires_at timestamptz, scopes text[], status: 'active'|'revoked'|'error', last_error text, updated_at)
sync_runs(id uuid pk, org_id, started_at, finished_at, status: 'running'|'ok'|'partial'|'error',
          calls int, egress_bytes bigint, error text)
sync_cursors(org_id, endpoint text, modified_since timestamptz, pk(org_id, endpoint))
accounts(org_id, xero_account_id uuid, code text, name text, type text, class text, reporting_code text,
         system_account text, status text, pk(org_id, xero_account_id))
account_maps(org_id, xero_account_id, category text, confidence real, source: 'rule'|'llm'|'confirmed', rule_id text, updated_at)
statements(id uuid pk, org_id, run_id, kind: 'pl'|'bs'|'cf', period_from date, period_to date,
           derived bool, reconciled bool null, recon_diff numeric null, created_at)
statement_lines(statement_id, org_id, xero_account_id null, code, name, section text, value numeric(14,2), sort int)
trial_balance(org_id, run_id, xero_account_id, code, name, ytd_debit numeric, ytd_credit numeric, as_at date)
supplier_spend(org_id, contact_id uuid, contact_name text, name_norm text, month date, amount numeric,
               source: 'bill'|'bank', pk(org_id, contact_id, month, source))
detected_apps(org_id, app_id, spend_12m numeric, months_seen int, last_seen date, evidence jsonb, pk(org_id, app_id))
flags(id uuid pk, org_id, run_id, statement_kind, line_key text, xero_account_id, rule_id, rule_version int,
      value numeric, base numeric, materiality real, band 'high'|'medium'|'low', coverage_gap real, strength real,
      state text, evidence jsonb, created_at)
recommendations(flag_id, app_id, rank int, match real, components jsonb, in_use bool, reason text)
flag_feedback(id uuid pk, flag_id, org_id, user_id, answer 'yes'|'no', note text, created_at)
line_overrides(org_id, line_key, rule_id, state 'marked_fine', user_id, created_at, pk(org_id,line_key,rule_id))
apps(id text pk, name, website, categories text[], markets text[], crawl jsonb, sample bool, updated_at)
fingerprints(app_id, pattern text, kind 'name'|'alias')
integrations(from_app, to_app, kind 'native'|'via_app'|'csv')
app_facts(app_id, field text, value jsonb, state text, quote text, source_url text, checked_at, checked_by, sample bool,
          pk(app_id, field))
crawl_pages(app_id, kind text, url text, fetched_at, status 'ok'|'blocked'|'error', text_hash text, text text)
org_essentials(org_id, key text, covered bool, updated_at)
shortlist(org_id, app_id, line_key text, added_by, created_at)
review_queue(id uuid pk, kind text, org_id null, ref jsonb, ref_hash text, reason text,
             status 'open'|'done'|'dismissed', assignee text null, resolution jsonb, created_at, resolved_at,
             unique(kind, ref_hash))
audit_log(id bigserial, actor, action, target jsonb, at)
```

### RLS
- Policies: `org_id = current_setting('app.org_id')::uuid`.
- `withOrg(orgId, fn)` opens a transaction, runs `set_config('app.org_id', $1, true)`, then `fn(tx)`.
- Admin/queue routes use a separate DB role with `BYPASSRLS`, only behind the admin check.
- Catalogue tables (`apps`, `app_facts`, …) are global, read-only to the app role.

### Retention
- Raw report JSON is never stored; parse it and drop it.
- `supplier_spend` keeps 24 months.
- Disconnecting an org deletes its tokens immediately. `DELETE /api/orgs/:id` deletes all its rows.

---

## 13. API (route handlers, all JSON, Zod-validated)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/auth/xero/start` | PKCE + state cookie → redirect to Xero |
| GET | `/api/auth/xero/callback` | exchange code, verify id_token, upsert user/org/connection, start first refresh, redirect `/app/<org>` |
| POST | `/api/auth/logout` | clear session |
| POST | `/api/orgs/:org/disconnect` | revoke + delete tokens |
| POST | `/api/orgs/:org/refresh` | run a refresh (inline in dev mode) → `{runId, status}` |
| GET | `/api/orgs/:org/refresh/:runId` | progress per step |
| GET | `/api/orgs/:org/summary` | hero £ at stake, flagged/total lines, apps in use, apps matched, shortlist monthly cost |
| GET | `/api/orgs/:org/statements/:kind` | `kind=pl|bs|cf`: period label, sections, lines with state/band/share |
| GET | `/api/orgs/:org/lines/:lineKey` | evidence, cause, recommendations, detected apps in area |
| POST | `/api/flags/:id/feedback` | `{answer, note?}` |
| GET / PUT | `/api/orgs/:org/settings` | markets, industry, "include current month" |
| GET / PUT | `/api/orgs/:org/essentials` | list + covered toggles |
| GET / POST / DELETE | `/api/orgs/:org/shortlist` | shortlist |
| GET | `/api/apps` / `/api/apps/:id` | directory; facts with state, source, date, sample flag |
| GET | `/api/admin/queue` · POST `/api/admin/queue/:id/resolve` | review queue |
| GET | `/api/admin/fp-report` | FP rate overall / per rule / per week |
| POST | `/api/admin/crawl` | crawl one app or all |
| GET | `/api/cron/nightly` · `/api/cron/monthly` | `Authorization: Bearer CRON_SECRET` |
| GET | `/api/health` | DB + config check (no secrets) |

Example `GET /api/orgs/:org/statements/pl`:
```json
{
  "kind": "pl", "label": "Profit and loss", "period": { "label": "Year to date", "from": "2026-04-01", "to": "2026-10-31" },
  "derived": false, "base": { "label": "Revenue", "value": 2554000 },
  "sections": [{ "key": "opex", "label": "Overheads", "lines": [
    { "key": "pl:477", "code": "477", "name": "Wages and Salaries", "value": 690000, "share": 0.27,
      "band": "high", "state": "flagged", "flagId": "…", "topApp": { "id": "staffology", "match": 86 } }
  ]}],
  "sample": false
}
```

---

## 14. Milestones for Claude Code (build in order; each ends green)

**M0 — Scaffold (½ day)**
- Next.js + TS strict, pnpm, eslint, vitest, pino.
- `docker-compose.yml` (postgres:16), Drizzle config, `.env.example`, `/api/health`.
- *Done when* `pnpm dev`, `pnpm test` and `pnpm lint` pass and `/api/health` returns ok.

**M1 — Xero client + fixtures (1 day)**
- `lib/xero/client.ts`: fetch wrapper with token refresh under advisory lock, a per-org token bucket (60/min, 5 concurrent), `Retry-After`, header tracking, byte metering.
- `XERO_MODE=fixtures` reads `/fixtures/xero/<set>/<endpoint>.json`.
- `pnpm xero:record` records the Demo Company into fixtures, anonymising contact names except those that match fingerprints.
- *Done when* the parser tests pass on recorded P&L/BS/TB fixtures.

**M2 — OAuth + sessions (1 day)**
- Start/callback/logout/disconnect, encrypted tokens, the connections call, id_token verification, org upsert, `withOrg` + RLS migration.
- *Done when* you can connect the Demo Company locally and see a `xero_connections` row with encrypted blobs, and a cross-org query returns zero rows in a test.

**M3 — Statements (1½ days)**
- Refresh pipeline (§3.4), report parser, accounts sync, mapping (rules only), P&L/BS, derived cash flow with reconciliation, statement endpoints.
- *Done when* P&L and BS totals equal Xero's report totals for the Demo Company, cash flow reconciles (or opens a queue item), and unit tests cover the cash flow fixtures.

**M4 — Apps in use (1 day)**
- Bills + bank spend aggregation (rows never persisted; a test asserts no row-level table exists), normalisation, fingerprint matching, `detected_apps`, queue items.
- *Done when* the Demo Company's software suppliers are detected or queued.

**M5 — Flags + scoring (1½ days)**
- `catalog/*.yaml` loader with Zod, rules, materiality, states, evidence, scoring including the in-use app, summary + line endpoints.
- *Done when* unit tests cover every state and band, and the hero £ matches a hand calculation on the fixture.

**M6 — Review queue + admin (1 day)**
- Queue table, dedupe, admin routes, resolution side effects (recompute the org), audit log.
- *Done when* resolving an `account_mapping` item flips that line from `queued` to a computed state.

**M7 — Feedback + eval (1 day)**
- Feedback endpoint, line overrides, FP report, `pnpm eval` over `/fixtures/labelled`, CI gate.
- *Done when* `pnpm eval` prints per-rule rates and fails above `FP_GATE`.

**M8 — Catalogue facts + crawl (1½ days)**
- Seed 25 apps from the ledger prototype with `sample: true`, fact states, directory endpoints, crawl script with the quote check.
- *Done when* a crawl on 3 apps produces found/missing facts and queue items, and no fact without a matching quote is stored.

**M9 — Deploy (½ day)**
- Vercel project + Neon, env vars, `pnpm db:migrate` on deploy, Vercel Cron (`nightly` 02:17, `monthly` 1st 03:41), Sentry.
- Optionally move refresh to Inngest if cold-start time matters.
- *Done when* the preview URL connects the Demo Company end to end.

---

## 15. Dev mode: run it today

1. **Xero app:** developer.xero.com → My Apps → New app → *Web app*. Redirect URIs `http://localhost:3000/api/auth/xero/callback` (+ the Vercel URL later). Copy the client ID and secret. Starter plan is the default; no card needed.
2. **Demo Company:** in Xero, open the org menu → "Try the Demo Company" (pick UK). Its data is regenerated and dated around today, and it can be reset at any time.
3. **Local:**
   ```bash
   pnpm i
   cp .env.example .env.local      # fill in the values below
   docker compose up -d db
   pnpm db:migrate && pnpm db:seed  # catalogue (sample-labelled) + essentials
   pnpm dev                          # http://localhost:3000/api/auth/xero/start
   ```
   No Xero yet? Set `XERO_MODE=fixtures` and `pnpm db:seed --demo-org` creates an org from the fixtures.
4. **Useful scripts:**
   - `pnpm xero:record`: record Demo Company fixtures
   - `pnpm refresh <orgId>`: run a refresh from the terminal
   - `pnpm eval`: FP rate on the labelled set
   - `pnpm crawl [appId]`: crawl the catalogue
   - `pnpm queue`: print open review items

### `.env.example`
```
APP_URL=http://localhost:3000
DATABASE_URL=postgres://flowstack:flowstack@localhost:5432/flowstack
DATABASE_ADMIN_URL=postgres://flowstack_admin:flowstack@localhost:5432/flowstack   # BYPASSRLS role
XERO_MODE=live                     # live | fixtures
XERO_FIXTURE_SET=demo-uk
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
XERO_REDIRECT_URI=http://localhost:3000/api/auth/xero/callback
XERO_SCOPES="openid profile email offline_access accounting.settings.read accounting.contacts.read accounting.reports.profitandloss.read accounting.reports.balancesheet.read accounting.reports.trialbalance.read accounting.reports.aged.read accounting.invoices.read accounting.banktransactions.read"
XERO_WEBHOOK_KEY=                  # later
TOKEN_ENC_KEY=                     # openssl rand -base64 32
SESSION_SECRET=                    # openssl rand -base64 48
ADMIN_EMAILS=svinujan10@gmail.com
LLM_ENABLED=false
ANTHROPIC_API_KEY=
TAVILY_API_KEY=
CRON_SECRET=
SENTRY_DSN=
HIGH_BAND=0.10
MED_BAND=0.02
MAP_CONFIDENCE_MIN=0.75
FP_GATE=0.15
```

---

## 16. Repo layout (backend)

```
/app/api/**                 route handlers (§13)
/lib/xero/                  oauth.ts, client.ts (rate limit, refresh, metering), fixtures.ts, parse-report.ts, endpoints.ts
/lib/sync/refresh.ts        orchestrates §3.4; writes sync_runs
/lib/statements/            build-pl.ts, build-bs.ts, cashflow.ts (§4)
/lib/mapping/               rules.ts, llm.ts, index.ts (§5)
/lib/detect/                aggregate.ts, normalise.ts, match.ts (§6)
/lib/signals/               compute.ts, states.ts, evidence.ts (§7)
/lib/rank/                  score.ts (§8.3)
/lib/catalog/               load.ts (YAML + Zod), facts.ts
/lib/crawl/                 fetch.ts, extract.ts, quote-check.ts (§11)
/lib/queue/                 enqueue.ts, resolve.ts (§9)
/lib/db/                    client.ts, with-org.ts
/lib/llm/                   client.ts (feature-only prompts, Zod output)
/catalog/                   app-categories.yaml, account-categories.yaml, apps.yaml, rules.yaml, markets.yaml, essentials.yaml
/db/                        schema.ts, migrations/, seed.ts
/fixtures/xero/demo-uk/     recorded JSON
/fixtures/labelled/         eval set
/scripts/                   record.ts, refresh.ts, eval.ts, crawl.ts, queue.ts
/tests/                     *.test.ts mirrored per lib folder
```

---

## 17. Guardrails (check in every PR)

- Only `.read` scopes. No calls with write methods to Xero anywhere in the code (a test greps `/lib/xero` for `PUT|POST` against `api.xro`).
- No ledger amounts, org names or contact names in LLM prompts, except account names in §5.3 and supplier names never.
- No raw report or transaction payloads in logs or the DB.
- Every number shown to users is traceable: a flag → evidence → trial balance row → run id.
- A missing fact is never replaced by an estimate. A test asserts that `price_fit` is 0.5 when the price is missing, and that the API returns `state: "missing"`.
- Seeded or invented data carries `sample: true` through to the API.

---

## 18. After 1.0 (keep the seams, don't build yet)

- **2.0:**
  - Tracking categories (P&L by `trackingCategoryID`) → sites and revenue centres.
  - KPIs: gross margin, labour % (wages ÷ revenue), net income %.
  - Market auto-detection from ACCREC invoice currency + contact country.
  - Volume questions → hours saved.
  - Priority presets.
- **3.0:**
  - HR KPIs.
  - Vendor newsletters → queue.
  - Anonymous verified peer feedback (incentive: give one, see all).
  - Vendor self-edits once uptake is strong.
  - Inngest + webhooks.
- **4.0:** runway and working-capital funding offers, triggered by cash headroom or stock days. Disclosed, separate from ranking. Revisit Finance API access here.
- **Firm plan (CLAUDE.md §1):** `firms` table + firm members across orgs. Bulk Connections need Xero's Advanced tier, so onboard one connection at a time until then.

## 19. Sources (checked 4 Nov 2026)
- Xero developer pricing and tiers: https://developer.xero.com/pricing
- Granular scopes (apps created after 2 Mar 2026): https://devblog.xero.com/upcoming-changes-to-xero-accounting-api-scopes-705c5a9621a0 and https://apideck.com/blog/xero-scopes
- Finance API restricted to financial institutions: https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/76610125/why-is-finance-statements-read-scope-not-accepted-by-xero-api
- Xero developer terms (AI/ML): https://developer.xero.com/xero-developer-platform-terms-conditions
