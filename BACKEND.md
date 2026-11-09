# BACKEND.md — FlowStack backend 1.0 (dev mode first)

> Build spec for Claude Code. Read it end to end before writing code, then build the milestones in §14 in order.
> **Where this file conflicts with CLAUDE.md §3, §6 or §7, this file wins for release 1.0.** Everything else in CLAUDE.md still applies: read-only, no AI training on Xero data, tenant isolation, sample data labelled, no scraping of competitors.
> Written 4 Nov 2026. Re-check the Xero facts in §3 against developer.xero.com before you rely on them.

### Changelog
- **v1.1 (9 Nov 2026), cofounder review** (CHANGES-v1.1.md). Tags: DECIDED = build; PROPOSED = build, may change; OPEN = seam + TODO only (CHANGES-v1.1 §4).
  - **A:** users are any finance lead; optional `users.job_title`.
  - **B:** monthly BS + P&L (12 months), per-month cash flow, trend signals §7.3.
  - **C (PROPOSED):** app lifecycle (cycle, states, lapsing question) §6.
  - **D (PROPOSED):** four feedback answers and three metrics §10.
  - **E:** Stripe billing §20 (prices OPEN).
  - **F:** kinds are Add and Change only.
  - **G:** peer prices out of 1.0 (legal OPEN).
  - **I:** several businesses per user, switcher, firms, connection cap.
  - **K:** weights 0.50 / 0.35 / 0.10 / 0.05.
  - **L (PROPOSED):** 7 crawl pages + Companies House §11.
  - **M:** mapping led by reporting code + tax rate + synonyms §5.
  - **O:** reward ledger only (threshold OPEN).
  - **P:** ecommerce + SaaS first.
- **v1.0 (4 Nov 2026):** first version.

---

## 0. The goal in one paragraph

The finance lead (FD, financial controller, finance manager or head of finance) connects Xero (read-only). FlowStack pulls a handful of **reports**, builds the P&L (year to date and by month), balance sheet (each of the last 12 month ends) and cash flow (year to date and by month), and maps every account to a standard category. Then it flags each line that is **material** and has **no app covering it**, and each **trend** that has moved the wrong way (debtor, creditor and stock days, cash headroom), with the trial balance figure as evidence. It ranks apps for that line, including the app the business already uses. Anything the system is unsure about goes to a **review queue** for a person. Nothing is ever estimated or made up. The metric we run on is the **false-positive rate** (§10): flags users answer "We don't need an app" or "The numbers are wrong" ÷ flags they answered.

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
| 4 | `GET /Reports/BalanceSheet` | `date`=latest month end, `periods=11`, `timeframe=MONTH`, `standardLayout=true` | 12 month-end balance sheets in one call (column 0 = latest; total assets = base) (v1.1 B) |
| 4b | `GET /Reports/ProfitAndLoss` | `fromDate`/`toDate`=latest month, `periods=11`, `timeframe=MONTH`, `standardLayout=true` | 12 months of P&L for days ratios (v1.1 B) |
| 5 | `GET /Reports/BalanceSheet` | `date`=prior FY end, `standardLayout=true` | opening balances for YTD cash flow; **skipped when the prior FY end is inside the 12-month window** |

- `periods` max is 11 (check the current docs). If lower, page backwards with more calls.
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
- **Several businesses per user (v1.1 I).**
  - Each Xero business is its own consent (connecting many at once needs Xero's Advanced plan).
  - "Connect another business" is one click that returns to the same screen. After each callback, call `GET /connections` and upsert every tenant the user has authorised.
  - **Connection cap:** Starter allows 5 connections in total across all businesses (Core: 50). Count active `xero_connections` before starting OAuth (`XERO_CONNECTION_CAP`, default 5) and show a friendly message at the cap. Firm onboarding copy states the limit.

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
- **Per month (v1.1 B):** the same formula over each pair of consecutive month-end balance sheets and that month's P&L, giving a monthly cash flow trend. The reconciliation rule applies per month. Unreconciled months open **one** `cashflow_unreconciled` item per org (not one per month), listing the months.
- CFI covers capital expenditure net of disposals. CFF covers short- and long-term loans (drawdowns and repayments), directors' loans and equity.
- Tests: hand-built fixture where the answer is known; Demo Company; a fixture with a missing account type that must fail the reconciliation and open a queue item.

---

## 5. Account mapping

Each Xero account gets an **account category** (about 40, in `catalog/account-categories.yaml`). Signals work off categories, never raw codes.

Names are written by each business ("Labour", "Salaries", "Wages") and vary. The **reporting code** (Xero's standard tagging) and the **tax rate** are far more reliable, so they lead (v1.1 M).

The pipeline, in order, stopping at the first confident match:
1. **Confirmed map** from a previous user or admin answer (`account_maps.source = confirmed`), confidence 1.0.
2. **Reporting code** (the tagging) → category via `catalog/reporting-codes.yaml`, confidence 0.9.
3. **Type + tax rate + name synonyms** (`catalog/account-synonyms.yaml`, plus each category's `name_any`), confidence 0.6–0.85.
4. **LLM suggestion** (only if `LLM_ENABLED`): send **account names and types only, no amounts, no org name**. The response must be JSON `{category, confidence}` validated by Zod. Capped at 0.8.
5. Below `MAP_CONFIDENCE_MIN` (default 0.75): category `unmapped`, open a review-queue item `kind=account_mapping`. **Lines on unmapped accounts are never flagged.**

**Tax-rate checks:**
- A wages account normally carries No VAT. An account named like wages that uses 20% VAT is probably agency labour or contractors: map it to `agency_staff` at confidence ≤ 0.7, which queues it.
- Any category whose `expected_tax` disagrees with the account's `TaxType` loses 0.15 confidence.

**Inputs:**
- Store `tax_type`, `reporting_code` and `reporting_code_name` on `accounts`; `/Accounts` returns them.
- Three recorded charts of accounts with different naming in `/fixtures/xero/`; the mapping is unit tested across all three.

```yaml
# catalog/account-synonyms.yaml (excerpt)
wages:        [wages, salaries, salary, labour, labor, payroll, staff costs, staff wages, gross pay]
employer_ni:  [employers ni, er ni, national insurance, nic]
pensions:     [pension, pensions, auto enrolment, nest]
agency_staff: [agency, temp staff, contractors, freelancers]
software:     [software, subscriptions, saas, it costs, computer costs]
```

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
6. `detected_apps` rows: `app_id, spend_12m, months_seen, last_seen, evidence {contact names, sources}, cycle, state, next_expected`.

### 6.1 App lifecycle: when payments stop (v1.1 C, PROPOSED; the rule itself is OPEN item 4)
1. **Billing cycle** from the payment history: `monthly` (median gap 25–35 days), `quarterly` (80–100), `annual` (330–400), else `unknown`. Annual apps look back 13 months, not 4.
2. **States:**

   | State | When |
   |---|---|
   | `new` | first payment in the last 60 days |
   | `active` | paid within one cycle + 15 days' grace |
   | `lapsing` | one expected payment missed (past cycle + 15 days) |
   | `inactive` | two expected payments missed, or the user says they stopped |
   | `declared` | the user says they use it but we can't see payments (personal card, parent company, free plan) |

3. **On `lapsing`, ask in the app** (never outside it): "We haven't seen a payment to Pleo since August. Do you still use it?" The answers:
   - **Yes, still use it** → `declared`, ask again in 6 months.
   - **We moved to …** (pick an app) → old app `inactive`, new app `declared`, plus a `fingerprint_check` item.
   - **We stopped using it** → `inactive`.
4. **No answer:** `new`, `active`, `lapsing` and `declared` all count as coverage. `inactive` does not. One missed payment never produces a "you have no app" flag.
5. **New app in a category where another is active** → ask "Is Ramp replacing Pleo?" The answer feeds the change history (3.0 switch stats).
6. **Internal:** an unanswered `lapsing` older than 30 days opens `kind=app_lapsing`, to review the pattern.

Tables: `app_status_answers(org_id, app_id, answer, replaced_by_app_id null, user_id, created_at)`.

---

## 7. Flags (signals)

### 7.1 Rules
`catalog/rules.yaml` maps account categories to the app categories that can help. Thresholds live here, not in code.
```yaml
- id: payroll_no_bridge
  account_categories: [wages, employer_ni, pensions]
  app_categories: [payroll, rota]   # where recommendations come from
  covered_by: [payroll]             # in use → line is handled (defaults to app_categories)
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
coverage_gap = 0    if an app in use sits in the rule's covered_by categories  → state "covered"
                    (a same-job app that ranks higher is kept as evidence.switch_option — a note, not a flag)
             = 0.5  if an app in use only helps (in app_categories but not covered_by), e.g. a rota app for payroll
             = 1    if no app in use sits in any of the rule's app categories
# Coverage rule v2 (4 Nov 2026). v1 set gap 0.5 whenever a different app outranked the one in use; on the
# labelled set that flagged lines the business already pays to handle (61.9% FP). See NOTES.md.
strength     = coverage_gap × materiality
```

Line states:

| State | When |
|---|---|
| `flagged` | the rule has app categories, value ≥ min, gap > 0, mapping is confident |
| `covered` | gap = 0; show "Covered · <app>", plus "Could switch to <app>" when `switch_option` is set |
| `fine` | the rule has no app categories, or no rule applies |
| `marked_fine` | the user answered "We don't need an app for this" (persisted per org + line + rule) |
| `snoozed` | the user answered "Right, but not now": hidden for 90 days, then shown again (v1.1 D) |
| `queued` | the mapping is unsure, the user said the numbers are wrong, or cash flow is unreconciled; the line shows as "Checking" |

A line the user says an app already handles becomes `covered` by a `declared` app (§6.1).

- **Order:** flagged lines by `|value|` descending (the £ value is the cost of getting it wrong), then covered, then fine.
- **Hero number "£ at stake":** Σ |value| of `flagged` P&L cost lines (exclude revenue categories).
- **Evidence (every flag):**
  ```
  { trial_balance: {code, name, ytd_net, as_at},
    statement_value, base_label, base_value, materiality,
    detected_in_area: [{app, spend_12m, months_seen}],
    rule_id, rule_version }
  ```

### 7.3 Trend signals (v1.1 B)
Pure functions over the 12 monthly statements (`lib/signals/trends.ts`), each tested against fixtures. Thresholds in `catalog/rules.yaml → trends:`. "Last 3m" figures are annualised (× 4).

| key | Calculation | App categories |
|---|---|---|
| `debtor_days` | trade debtors ÷ (revenue last 3m × 4) × 365 | billing & receivables (chasing) |
| `creditor_days` | trade creditors ÷ ((cost of sales + overheads) last 3m × 4) × 365 | spend & payables |
| `stock_days` | inventory ÷ (cost of sales last 3m × 4) × 365 | inventory |
| `cash_headroom_months` | bank balance ÷ average monthly net cash outflow (last 3m) | cash flow forecasting (4.0 funding later) |

- **Fires when:**
  - the latest value is past the rule threshold (above it for days; below it for headroom), **and**
  - it has moved the wrong way by at least `min_change` (e.g. 7 days) over 3 months.

  Movement matters, not just level.
- **Materiality:**
  - The £ value is the extra balance tied up by the rise: (days now − days 3 months ago) ÷ 365 × the annualised base.
  - The base is revenue for debtors, and costs or cost of sales for creditors and stock.
  - It is then banded and ordered like any other flag.
- **Evidence:** the 12-month series, the trial balance line for the balance, and the formula with the numbers filled in.
- **Coverage:** a detected app in the rule's `covered_by` categories covers the trend, as in §7.2.
- **Line key:** `trend:<key>`.

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
match = 100 × ( 0.50 × strength_norm          # strength ÷ max strength across this org's flags (coverage × materiality)
              + 0.35 × fit_with_in_use        # native integration with an app they keep 1.0 | via app 0.8 | CSV 0.6 | none 0.3 | no apps to fit 0.5
              + 0.10 × peer_results           # 0.5 neutral until 3.0 feedback exists
              + 0.05 × price_fit )            # band vs revenue band; 0.5 neutral when price is missing (never estimated)
```
Weights v1.1 K; they live in `catalog/rules.yaml → scoring:`. Price is still shown in full on every option; it just barely moves the rank.
- Return the top 3 plus the in-use app if it isn't in the top 3. Each comes with `components` and a one-line `reason`.
- **Recommendation kinds (v1.1 F):**
  - `add`: no app covers the line.
  - `change`: an app is in use and a different one outranks it.
  - No `drop`.
  - `fix` is reserved for 2.0, because adoption needs transaction volumes 1.0 doesn't read.
  - No built-in preference: the score decides. The in-use app is always scored and shown next to the alternatives, so a Change is a visible choice, never a silent swap. (Confirm: CHANGES-v1.1 §4 item 6.)
- Coverage is decided by `covered_by` (§7.2), not by rank. When the line is covered but a same-job app ranks higher, both are shown (e.g. Pleo vs Ramp) and the higher one is recorded as `switch_option` (a Change).
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
| `flag_disputed` | user answers "We don't need an app for this" | tune the rule, or note why the flag stands |
| `app_lapsing` | a `lapsing` question unanswered for 30 days (§6.1) | note the pattern, or dismiss |

Rules:
- Items dedupe on `(kind, ref_hash)`.
- Resolving writes an `audit_log` row.
- The admin API lists open items, oldest first, filterable by kind.

---

## 10. False positives

"Not a problem" mixed different failures, so it is split into four answers, alongside **"Yes, this is right"** (v1.1 D, PROPOSED; confirm: CHANGES-v1.1 §4 item 5).

| Answer | Meaning | Counts as | What happens |
|---|---|---|---|
| `yes` | "Yes, this is right" | correct | nothing |
| `already_use_app` | "We already use an app for this" (pick it, or type a name) | **detection miss** | line → covered by a `declared` app; `fingerprint_check` item if the app isn't recognised |
| `no_app_needed` | "We don't need an app for this" | **false positive** | line → `marked_fine`; `flag_disputed` item |
| `numbers_wrong` | "This line or figure isn't right" | **false positive** (mapping/data) | line → `queued`; `account_mapping` item |
| `not_now` | "Right, but not a priority now" | neither | line → `snoozed` for 90 days |

- `POST /api/flags/:id/feedback`. Body:
  ```
  { answer: "yes" | "already_use_app" | "no_app_needed" | "numbers_wrong" | "not_now", app_id?, app_name?, note? }
  ```
  The old `"no"` is accepted as `no_app_needed` for one release.
- **Metrics,** overall, per rule and per week (`GET /api/admin/fp-report`):
  ```
  false-positive rate = (no_app_needed + numbers_wrong) ÷ (yes + no_app_needed + numbers_wrong + already_use_app)
  detection miss rate = already_use_app ÷ same denominator
  not_now             = excluded from both; reported as a count
  ```
- **Labelled test set:** `/fixtures/labelled/<org>.json` holds a chart of accounts + report fixtures + the expected state (and `expected_reason` where it isn't flagged) for every line, labelled by us. `pnpm eval` runs the full pipeline on each and prints FP rate and missed-flag rate per rule. **CI fails if the false-positive rate is above `FP_GATE` (0.15 for 1.0).** The gate uses the FP rate only.
- Every flag stores `rule_id` + `rule_version`, so rate changes can be traced to rule edits.

---

## 11. Crawl (monthly, `pnpm crawl` / cron)

For each app in `apps.yaml`:
1. Fetch up to 7 pages (home, services, pricing, product, **integrations, security/trust, terms**; v1.1 L) via Tavily Extract. Page URLs are found once by a person and written into `apps.yaml`, never guessed. If there is no key, use `fetch` + Readability. Respect `robots.txt`; skip disallowed pages and record `blocked`.
2. Store page text + hash in `crawl_pages`. Unchanged hash → skip extraction.
3. Extraction (`claude-haiku-5-5`, if enabled) returns JSON `[{field, value, quote}]`, validated by Zod.
4. **Quote check:** keep a fact only if `quote` appears verbatim in the normalised page text (whitespace and case folded). No quote match, no fact.
5. Compare with the current fact. New or changed → `found` (+20% sampled to `fact_spot_check`). Fields not found anywhere → `missing` + queue. Disagreement between pages → `conflicting` + queue.
6. Facts not confirmed for 90 days → `stale` (nightly job).
7. **Never auto-promote to `verified`.** The one exception is official registry data: **Companies House** (`lib/vendors/companies-house.ts`, `COMPANIES_HOUSE_API_KEY`). It gives incorporation date, officers, persons with significant control and filing history. These are stored as `verified` facts (`vendor_incorporated`, `vendor_ownership_changes`) with the Companies House URL as the source.

**What can be automated (v1.1 L, PROPOSED).** Expect about half the fields; the rest stay Missing until a person or our users fill them.

| Field | Automatable? | How |
|---|---|---|
| Pricing model, published price, free trial, setup fee | Yes, often | pricing page + quote check |
| Integrations with apps they keep | Mostly | vendor integrations page; Xero App Store listing entered by hand |
| Security certifications, data location | Often | security/trust page |
| Contract: minimum term, notice, auto-renew, data export | Sometimes | terms page (many fields will be Missing → queue) |
| Vendor age, ownership changes | Yes (UK) | Companies House API |
| What posts to Xero and how | Partly | help centre; often a person |
| Days to go live, support after go-live, what peers pay | No | our users (3.0) |

---

## 12. Data model (Drizzle, `/db/schema.ts`)

All tenant tables have `org_id` and **RLS on**.

```ts
users(id uuid pk, email text unique, name text, xero_user_id text, is_admin bool, job_title text null, created_at)
                                                                   -- job_title: asked once; changes no permissions (v1.1 A)
orgs(id uuid pk, name, base_currency, country, fy_end_month int, fy_end_day int, industry text null,
     markets text[] default '{UK}', firm_id uuid null, created_at)     -- industry gains 'ecommerce', 'saas' (v1.1 P)
org_members(org_id, user_id, role: 'owner'|'member', pk(org_id,user_id))
firms(id uuid pk, name, created_at) · firm_members(firm_id, user_id, role)                    -- v1.1 I
-- session carries active_org_id (v1.1 I)
xero_connections(id uuid pk, org_id, tenant_id text unique, connection_id text, enc_access bytea, enc_refresh bytea,
                 expires_at timestamptz, scopes text[], status: 'active'|'revoked'|'error', last_error text, updated_at)
sync_runs(id uuid pk, org_id, started_at, finished_at, status: 'running'|'ok'|'partial'|'error',
          calls int, egress_bytes bigint, error text)
sync_cursors(org_id, endpoint text, modified_since timestamptz, pk(org_id, endpoint))
accounts(org_id, xero_account_id uuid, code text, name text, type text, class text, reporting_code text,
         reporting_code_name text, tax_type text, system_account text, status text, pk(org_id, xero_account_id))
account_maps(org_id, xero_account_id, category text, confidence real, source: 'rule'|'llm'|'confirmed', rule_id text, updated_at)
statements(id uuid pk, org_id, run_id, kind: 'pl'|'bs'|'cf'|'bs_monthly'|'pl_monthly'|'cf_monthly', period_from date,
           period_to date, derived bool, reconciled bool null, recon_diff numeric null, created_at)
statement_lines(statement_id, org_id, xero_account_id null, code, name, section text, value numeric(14,2), sort int,
                period_index int null, period_end date null)   -- monthly kinds: one row per line per month (0 = latest)
trial_balance(org_id, run_id, xero_account_id, code, name, ytd_debit numeric, ytd_credit numeric, as_at date)
supplier_spend(org_id, contact_id uuid, contact_name text, name_norm text, month date, amount numeric,
               source: 'bill'|'bank', pk(org_id, contact_id, month, source))
detected_apps(org_id, app_id, spend_12m numeric, months_seen int, last_seen date, evidence jsonb,
              cycle text, state text, next_expected date, pk(org_id, app_id))                        -- v1.1 C
app_status_answers(org_id, app_id, answer, replaced_by_app_id null, user_id, created_at)          -- v1.1 C
flags(id uuid pk, org_id, run_id, statement_kind, line_key text, xero_account_id, rule_id, rule_version int,
      value numeric, base numeric, materiality real, band 'high'|'medium'|'low', coverage_gap real, strength real,
      state text, evidence jsonb, created_at)
recommendations(flag_id, app_id, rank int, match real, components jsonb, in_use bool, kind 'add'|'change', reason text)
flag_feedback(id uuid pk, flag_id, org_id, user_id,
              answer 'yes'|'already_use_app'|'no_app_needed'|'numbers_wrong'|'not_now', app_id, app_name, note, created_at)
line_overrides(org_id, line_key, rule_id, state 'marked_fine'|'snoozed', until date null, user_id, created_at,
               pk(org_id,line_key,rule_id))
apps(id text pk, name, website, categories text[], markets text[], crawl jsonb, sample bool, claimed_by text null, updated_at)
                                                                   -- claimed_by kept; no vendor portal in 1.0 (v1.1 J)
subscriptions(org_id null, firm_id null, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end)
payments_log(id, stripe_event_id unique, type, payload_summary jsonb, created_at)               -- v1.1 E (§20)
reward_ledger(user_id, reviews_counted int, months_granted int, granted_at)                       -- v1.1 O, 3.0
price_observations                                                 -- OPEN (CHANGES-v1.1 §4 item 2): not shown in 1.0
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
| GET | `/api/orgs/:org/statements/:kind` | `kind=pl|bs|cf`: period label, sections, lines with state/band/share. `?months=12` returns the monthly series (v1.1 B) |
| GET | `/api/orgs/:org/lines/:lineKey` | evidence, cause, recommendations, detected apps in area |
| POST | `/api/flags/:id/feedback` | `{answer, app_id?, app_name?, note?}` (§10) |
| GET | `/api/me/orgs` | the user's businesses: name, last refresh, £ at stake (v1.1 I) |
| POST | `/api/me/active-org` | `{orgId}` → session `active_org_id` (member check) |
| POST | `/api/orgs/:org/apps/:appId/status` | lapsing answer `{answer: still_use|moved|stopped, replaced_by_app_id?}` (§6.1) |
| POST | `/api/billing/checkout` · `/api/billing/portal` | Stripe Checkout / Customer Portal (§20) |
| POST | `/api/stripe/webhook` | signature-verified Stripe events (§20) |
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

**v1.1 additions to milestones (CHANGES-v1.1 §3):**
- **M2:** multi-business membership, the switcher, `firms`, and the connection-cap check (I).
- **M3:** monthly BS and P&L calls, per-month cash flow, and `statements/bs?months=12` (B).
- **M4:** billing cycle, lifecycle states, lapsing questions and declared apps (C).
- **M5:** trend signals (B), the new weights (K), and Add/Change kinds (F).
- **M7:** four answers and three metrics (D).
- **M8:**
  - ecommerce/SaaS apps first (P)
  - 7 crawl pages and Companies House (L)
  - `reporting-codes.yaml` + `account-synonyms.yaml` + tax-rate checks (M)

**M9 — Deploy (½ day)**
- Vercel project + Neon, env vars, `pnpm db:migrate` on deploy, Vercel Cron (`nightly` 02:17, `monthly` 1st 03:41), Sentry.
- Optionally move refresh to Inngest if cold-start time matters.
- *Done when* the preview URL connects the Demo Company end to end.

**M10 — Billing (new, v1.1 E)**
- Stripe in **test mode only** and `catalog/plans.yaml` (§20). Prices stay OPEN.
- *Done when* a test-mode checkout creates a `subscriptions` row via the webhook, and the portal link opens.

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
XERO_CONNECTION_CAP=5              # Starter 5, Core 50 (v1.1 I)
COMPANIES_HOUSE_API_KEY=           # v1.1 L
STRIPE_SECRET_KEY=                 # test mode until prices are decided (v1.1 E)
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_IDS_JSON=
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
- **Firm plan (CLAUDE.md §1):** `firms` table + firm members across orgs (built, v1.1 I). Bulk Connections need Xero's Advanced tier, so onboard one connection at a time until then. The **Monday digest** is parked here (v1.1 H).
- **Peer price ranges** (OPEN, CHANGES-v1.1 §4 item 2): opt-in, p25–p75 rounded to £5, ≥10 businesses per size band, never a single value. Needs written sign-off from a lawyer and from Xero's partner team first.
- **Activators** (3.0; threshold OPEN, item 3): `reward_ledger` only.

## 19. Sources (checked 4 Nov 2026)
- Xero developer pricing and tiers: https://developer.xero.com/pricing
- Granular scopes (apps created after 2 Mar 2026): https://devblog.xero.com/upcoming-changes-to-xero-accounting-api-scopes-705c5a9621a0 and https://apideck.com/blog/xero-scopes
- Finance API restricted to financial institutions: https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/76610125/why-is-finance-statements-read-scope-not-accepted-by-xero-api
- Xero developer terms (AI/ML): https://developer.xero.com/xero-developer-platform-terms-conditions

## 20. Billing (v1.1 E: Stripe DECIDED; prices OPEN, CHANGES-v1.1 §4 item 1 and §N)

- **Stripe products:**
  - Checkout for sign-up
  - Billing for subscriptions
  - Customer Portal for card changes and cancellation
  - Stripe Tax once VAT-registered
- **Code:**
  - `lib/billing/` and `POST /api/billing/checkout`
  - `POST /api/billing/portal`
  - `POST /api/stripe/webhook`: verify the signature; handle `checkout.session.completed`, `customer.subscription.updated|deleted` and `invoice.payment_failed`
- **Plans live in `catalog/plans.yaml`**, never in code. Seed it with **test-mode** prices only until prices are decided.
  - The audit is a one-off price; "audit waived" is a Stripe coupon.
  - The 12-month option is an annual price.
- **Fees (re-check before setting prices):**
  - UK standard cards: 1.5% + 20p
  - Premium/corporate cards: 1.9% + 20p
  - Billing: 0.7% of recurring volume

  That's about 72p on £19.99 (≈3.6%).
- **Unit costs (rough, OPEN §N):**
  - Xero Core: $35 AUD / 50 connections, ≈ £0.36 per business when full
  - Crawl LLM: a few £ a month for the whole catalogue
  - Hosting: tens of £, fixed

  Gross margin is above 90%. The real constraints are churn after the first stack decision, and queue time.
