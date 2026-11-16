# UI-SPEC.md — FlowStack 1.0 front end

> For the front-end developer. **Your design files decide how things look.** This spec decides what each screen does, what data it shows, every state it can be in, and the exact API contract. Where the design and this spec disagree on behaviour or data, ask before building.
> Version 1.0 · 13 Nov 2026 · Owner: Vinu. Read CLAUDE.md §1 and §8 for product background.
> Saved into the repo 13 Nov 2026 as received. Differences from the built backend are listed in NOTES.md ("UI-SPEC vs backend").

---

## 1. What we're building, in one paragraph

A finance lead connects their business's Xero (read-only). FlowStack builds their P&L (year to date), balance sheet (latest month end, plus 12 months of history) and cash flow (year to date, derived). It flags each line that is **material** and has **no app covering it**, with evidence, and ranks apps for that line, including the app they already use. Users answer "Is this right?" on every flag, and those answers are how we measure false positives, our main quality metric. **Nothing is ever estimated.** A missing fact shows as "Not published · we're checking".

**Users:** finance leads (FD, financial controller, finance manager, head of finance) at UK ecommerce and SaaS businesses, plus accountants and bookkeepers who look after several businesses and switch between them.

---

## 2. Rules every screen follows

1. **Evidence everywhere.** Every flag, number and recommendation links to where it came from: trial balance line, report, run date.
2. **Never invent.**
   - A `null` price shows as "Not published · we're checking". Never a dash or a guess.
   - A fact with state `missing` never shows a value.
3. **Sample data is labelled.**
   - Anything with `sample: true` shows a visible "Sample" tag next to it.
   - A sample org shows a page-wide banner.
4. **Finance-plain words.** Use "£", months, "year to date", "finance lead". Never use "AI-powered", "insights", "smart" or emoji. Spell out abbreviations on first use.
5. **Colour never carries meaning alone.** Bands and states always carry their words too ("High impact · 27%").
6. **Money format:** `£690,000`; in tight spaces `£690k`. Negative: `−£12,400` with a minus sign, not brackets, unless the design says otherwise. Percentages: whole numbers, except under 1%: `0.6%`.
7. **Dates:** `31 Oct 2026`. Periods: "Year to date (1 Apr – 31 Oct 2026)", "As at 31 Oct 2026".
8. **Works at 400px wide** and in light and dark themes, if the design supplies dark.

---

## 3. Tech and working with the backend

- **Framework:** Next.js App Router + TypeScript (strict) + Tailwind. Same repo as the backend.
- **Reads:** server components, through `lib/api/server.ts`.
- **Interactions:** client components, through `lib/api/client.ts` (fetch + SWR or TanStack Query, your choice).
- **Types:** the contract in §8 lives in `lib/api/types.ts`. Import from there and never redefine.
- **Mock mode:** `NEXT_PUBLIC_API_MODE=mock` serves `/mocks/*.json` through a route handler or MSW. You can build every screen before the backend is ready.
  - Mocks follow §8 exactly and are labelled `sample: true`.
  - Mock scenarios are switchable via a `?scenario=` query param:
    - `default`
    - `empty` (just connected, nothing flagged)
    - `refreshing`
    - `refresh_failed`
    - `unreconciled` (cash flow doesn't reconcile)
    - `revoked` (connection lost)
    - `lapsing` (app payment questions waiting)
    - `past_due` (payment failed)
    - `accountant` (5 businesses)
- **Errors:** every API error returns `ApiError` (§8). Show `message`, offer retry when `retryable`, and show `requestId` in small text so bug reports can quote it.
- **Charts:** any small library (Recharts, visx). Every chart has a "Show as table" toggle for accessibility.
- **Auth:** a session cookie set by the backend after "Sign in with Xero". Unauthenticated requests to `/app/**` redirect to `/connect`.

---

## 4. Sitemap

```
/                                Landing + waitlist                     public
/connect                         Before-you-connect screen               public
/connect/progress?run=<id>       First refresh progress                  signed in
/setup                           Markets, industry, job title            signed in, first time
/app                             → redirects to /app/<activeOrgId>
/app/[org]                       Overview
/app/[org]/statements/[kind]     kind = pl | bs | cf
/app/[org]/lines/[lineKey]       Line detail (opens as side panel over statements; full page on mobile)
/app/[org]/apps                  App directory
/app/[org]/apps/[appId]          App dossier
/app/[org]/compare?apps=a,b,c    Compare 2–3 apps (nice-to-have in 1.0)
/app/[org]/in-use                Apps we found in their spend + lifecycle answers
/app/[org]/essentials            Every-year essentials
/app/[org]/settings              Business settings, members, connection, digest
/app/[org]/billing               Plan, checkout, portal
/billing/success · /billing/cancel
/admin/queue · /admin/fp · /admin/churn · /admin/digest/[org]     internal, admins only
```

**Persistent shell (all `/app/**` routes):**
- Business switcher
- Main nav: Overview · Statements · Apps in use · Every year · App directory
- Shortlist button with a count badge, which opens the shortlist drawer
- Account menu: settings, billing, sign out
- Global banners (§5.12)

---

## 5. Screens

Each screen lists: **purpose · data · layout and components · states · interactions · copy**.

### 5.1 Landing `/`

- **Purpose:** explain FlowStack and collect waitlist sign-ups. The sales outreach links here.
- **Sections:**
  1. Hero: one line plus "Join the waitlist" and "See a sample" (links to the sample org in mock/demo).
  2. Read-only promise: what we read, what we never do (write to your books, store transactions, train AI on your data).
  3. "Time is salary" calculator (spec below).
  4. How it works in 3 steps: connect, see your flags with evidence, choose apps with every fact in one place.
  5. Sourced stats, each with a link: "Xero's app ecosystem grew from 1,000+ apps (May 2021) to 1,100+ (March 2024)".
  6. Waitlist form.
- **Calculator:**
  - Inputs: annual salary (default £55,000), hours per app decision (default 10, labelled "example, change it").
  - Output: hourly cost = salary ÷ 1,800, then cost per app decision.
  - Show the formula under the result.
- **Waitlist form:** email, name, company, role (select: FD / Financial controller / Finance manager / Head of finance / Accountant or bookkeeper / Other), industry (Ecommerce / SaaS / Other), consent checkbox (required).
  - `POST /api/waitlist`.
  - States: idle, submitting, success ("You're on the list. We'll email you once."), duplicate email (same success message, don't reveal), error.
- **SEO:** title "FlowStack: the right Xero apps for your business, from your own books".

### 5.2 Before you connect `/connect`

- **Purpose:** build trust before the Xero login.
- **Content:**
  - What we read: reports, chart of accounts, supplier totals.
  - What we never do: write to your books, store individual transactions, train AI on your data, sell your data.
  - How to disconnect, at any time.
  - One optional, **unticked** checkbox: "Add my anonymised app prices to peer benchmarks (shown only when 10+ businesses contribute)".
- **Action:** "Connect Xero" → `GET /api/auth/xero/start?benchmarkOptIn=0|1` (full-page redirect).
- **Accountant note:** "Look after several businesses? Connect one now; you can add the others straight after."
- **Error:** `?error=<code>` returned from Xero. Show a friendly message per code: `access_denied` → "You cancelled the Xero connection. Nothing was shared." Plus `XERO_CONNECTION_CAP` and generic.

### 5.3 First refresh progress `/connect/progress?run=<id>`

- **Data:** `GET /api/orgs/:org/refresh/:runId`, polled every 2s until `status != running`.
- **Layout:** one row per step from `RefreshRun.steps`, each pending, running, done or error, with its `label`. Typical: Business details, Chart of accounts, Profit and loss, Balance sheet (12 months), Trial balance, Supplier spend, Checking lines.
- **Done:**
  - First time → `/setup`.
  - Otherwise → `/app/<org>`.
- **Partial:** continue, with a banner "Some data couldn't load: <steps>. We'll retry tonight."
- **Error:** message + "Try again" (`POST /api/orgs/:org/refresh`) + requestId.
- **Target:** finished in under 2 minutes. After 60s, show "Still working, large ledgers take longer."

### 5.4 Set-up `/setup` (first time only, editable later in Settings)

- **Fields:**
  - Markets: multi-select UK / US / Canada / Australia; default from Xero's org country.
  - Industry: Ecommerce / SaaS / Other.
  - Your role: same list as the waitlist.
  - Include the current month: toggle, default off, helper "Off uses the last full month".
- **Save:** `PUT /api/orgs/:org/settings`, `PUT /api/me` (job title) → `/app/<org>`.
- **Validation:** at least one market.

### 5.5 Overview `/app/[org]`

**Data:** `GET /api/orgs/:org/summary`

**Layout:**
1. **Hero number:** `atStake` (e.g. £1.61m) + `atStakeLabel` ("of this year's costs run through lines with no app behind them") + period.
2. **Strip:**
   - lines flagged: `flaggedLines` of `totalLines`
   - apps you already pay for: `appsInUse`
   - apps matched: `appsMatched`
   - shortlist cost per month: `shortlistMonthly`, plus "+ N with no published price"
3. **Questions for you:** cards from `questions` (lifecycle; §5.9). Hidden when empty.
4. **Biggest lines to fix:** top 5 `biggestLines`. Each shows name, code, value, band tag, top app; a click opens line detail.
5. **Trends:** one small card per `TrendSignal`.
   - Sparkline of 12 months, latest value, change over 3 months ("Debtor days 52, up 14 in 3 months").
   - Flagged trends show their band and open line detail via `flagId`.

**States:**
- Loading: skeletons.
- Empty (`flaggedLines = 0`): "Nothing material without an app. We'll keep checking every night." Show trends still.
- Refreshing: an inline note "Updating from Xero…" with the last refresh time.

### 5.6 Statements `/app/[org]/statements/[kind]`

**Data:** `GET /api/orgs/:org/statements/:kind` (bs also supports `?months=12` for the history view)

**Layout:**
- Switcher: Profit and loss (Year to date) · Balance sheet (Latest month) · Cash flow (Year to date).
- Period line.
- `derived` → a note under the title: "Cash flow derived from your balance sheet."
- **Sections** with totals, then **line rows**: code, name, value, share of base, state tag, top app.
- Balance sheet history toggle: "Show 12 months", which adds monthly columns. Horizontal scroll inside the table only, never the page.
- Filter chips: All · Flagged · Covered · Fine. Sort: by value (default) or by code.
- A row click opens the **line detail panel** (§5.7) and updates the URL to `/lines/<lineKey>`, so links are shareable. Esc closes it.

**Line state tags (exact words):**

| state | Tag text | Notes |
|---|---|---|
| `flagged` | "High impact · 27%" / "Medium impact · 4%" / "Low impact · 0.6%" | uses `band` + `share`; only `high` uses the "needs action" accent |
| `covered` | "Covered · Pleo" | `coveredBy.name` |
| `fine` | "Fine as is" | muted |
| `marked_fine` | "Marked fine" | muted, with tooltip "You said this isn't a problem" |
| `queued` | "Checking" | tooltip "We're confirming how this account is used" |
| `snoozed` | "Not now" | tooltip "Hidden until <date>" |

- **One-off note:** if `oneOffNote` is present, show a small "May be a one-off" marker beside the tag.
- **Unreconciled cash flow** (`reconciled = false`): banner at the top of the cash flow statement: "Cash flow doesn't reconcile yet: £<reconDiff> unexplained. We're checking." Cash flow lines show no flags.

### 5.7 Line detail (side panel) `/app/[org]/lines/[lineKey]`

**Data:** `GET /api/orgs/:org/lines/:lineKey`

**Layout, top to bottom:**
1. **Header:** line name, code, value, state tag, close button.
2. **Evidence** (always visible, never collapsed):
   - "Trial balance at <asAt>: <code> <name> £<ytdNet>"
   - "Size: <materiality>% of <base.label> (£<base.value>)"
   - "Apps in your spend in this area: Deputy (£10,800 in 12 months) …", or "None found"
   - A 12-month mini chart when `series` is present
   - Small print: "From Xero, refreshed <date> · rule <ruleId> v<ruleVersion>"
3. **Likely cause:** `cause` text, prefixed "Likely cause, only your team can confirm:".
4. **Is this right?** (feedback), §5.7a.
5. **Apps for this line:** the `recommendations` list, ranked.
   - Each card: rank `#1`, name, match `86`, one-line `reason`, price (FactValue rules), "You use this" badge when `inUse`, "Sample" tag when sample, kind badge ("Add" / "Change"; none for the app in use, whose `kind` is null).
   - Actions: "Add to shortlist", "View details" (dossier), and checkboxes to compare up to 3.
   - Expanding a card shows the score breakdown: strength / fit / peers / price, each as a bar with its weight (50 / 35 / 10 / 5).
6. **Empty recommendations** for a fine line: "No app category applies to this line."

#### 5.7a Feedback control (exact behaviour)

- **First choice:** two buttons, **"Yes, this is right"** and **"No…"**.
- **"No…" reveals four options** (radio):

  | Option label | `answer` | Follow-up |
  |---|---|---|
  | We already use an app for this | `already_use_app` | App picker (search catalogue) or free-text name |
  | We don't need an app for this | `no_app_needed` | Optional note |
  | The numbers are wrong | `numbers_wrong` | Required sub-reason (below) |
  | Right, but not now | `not_now` | none |

- **"The numbers are wrong" sub-reasons** (radio, required):

  | Label | `subReason` |
  |---|---|
  | This account isn't what you think it is | `wrong_category` |
  | The amount isn't what our Xero shows | `figure_mismatch` |
  | It's a one-off cost, not ongoing | `one_off` |
  | It's in the wrong account on our side | `miscoded` |

- **Submit:** `POST /api/flags/:flagId/feedback`. Optimistic update of the line state from the response's `line.state`.
- **After submit:** show what happens next, from the response's `message`, e.g. "Thanks. We've updated this from Xero." or "Got it. Hidden until 11 Feb 2027."
- **Undo:** an "Undo" link for 10 seconds → `DELETE /api/flags/:flagId/feedback`.
- **Existing feedback:** show it with "Change answer".

### 5.8 App directory `/app/[org]/apps` and dossier `/app/[org]/apps/[appId]`

**Directory**
- **Data:** `GET /api/apps?category=&market=&q=`
- Grid or list: name, categories, markets, price (FactValue rules), "Sample" tag.
- Filters: category, market (defaults to the org's markets), search.

**Dossier**
- **Data:** `GET /api/apps/:id`
- **Fact groups:**
  - Price
  - Contract
  - Fit and integrations
  - Going live
  - Security
  - Support
  - Vendor
- **Each fact** shows its value plus a state badge:

  | state | Badge | Value shown |
  |---|---|---|
  | `verified` | "Checked <date>" | yes, with source link |
  | `found` | "From the vendor's site" | yes, with source link |
  | `missing` | "Not published · we're checking" | **no value** |
  | `conflicting` | "Being checked" | last verified value, if any |
  | `stale` | "Last checked <date>" | yes, muted |

- **Integrations:** list with kind ("Direct sync" / "Via another app" / "CSV"). Highlight apps the business already uses.

**Compare** (nice-to-have): same fact groups as columns for 2–3 apps; differences highlighted; missing facts shown the same way.

### 5.9 Apps in use `/app/[org]/in-use`

**Data:** `GET /api/orgs/:org/detected-apps`

**List:** app, category, spend in the last 12 months, billing cycle, last payment, state.

| state | Words |
|---|---|
| `new` | "New: first paid <date>" |
| `active` | "Active" |
| `lapsing` | "No payment seen since <date>" |
| `inactive` | "Stopped" |
| `declared` | "You told us you use this" |

**Lifecycle question** (also shown on Overview), for `lapsing`:
- Question: "We haven't seen a payment to <app> since <date>. Do you still use it?"
- Buttons: "Yes, still use it" · "We moved to…" (app picker) · "We stopped using it".
- `POST /api/orgs/:org/detected-apps/:appId/answer`.

**Replacement question:** "Is <new app> replacing <old app>?" · Yes / No.

**Add an app we can't see:** "Add an app you pay for outside Xero" → app picker → `declared`.

### 5.10 Every year `/app/[org]/essentials`

**Data:** `GET /api/orgs/:org/essentials`

- Checklist rows: name, how often, next due (when known), suggested cover.
- "Covered" toggle: `PUT /api/orgs/:org/essentials`.
- UK defaults: VAT returns (quarterly), Confirmation statement (yearly, £50 at Companies House), Month-end close calendar (monthly).

### 5.11 Shortlist drawer (shell)

- **Data:** `GET /api/orgs/:org/shortlist`
- **Items:** app, the line it's for, price.
- **Totals:** known monthly total, plus "N with no published price". Never sum unknowns.
- **Actions:**
  - remove
  - "Compare"
  - "Copy summary": plain text to the clipboard, for emailing a boss or client
  - "Request quotes": disabled in 1.0, "Coming soon"

### 5.12 Global banners (shell, from `Summary.banners` / `Me`)

| kind | Message | Action |
|---|---|---|
| `connection_revoked` | "Xero is disconnected for <org>." | "Reconnect" → `/connect` |
| `refresh_failed` | "Last update from Xero failed <time>." | "Try again" |
| `cashflow_unreconciled` | see §5.6 | – |
| `payment_failed` | "Your last payment failed." | "Update card" → portal |
| `sample` | "Sample data: not a real business." | – |
| `connection_cap` | "You've reached the number of businesses we can connect right now." | "Contact us" |

### 5.13 Business switcher (shell)

- **Data:** `GET /api/me` (`orgs`).
- Dropdown with search when there are more than 5 orgs. Each row: name, £ at stake, last refresh, warning dot if `connection != active`.
- **Select:** `POST /api/me/active-org` → navigate to `/app/<id>`.
- **"Connect another business"** → `/connect?add=1`. After the callback, return to the switcher with the new org selected.

### 5.14 Settings `/app/[org]/settings`

- **Business:** markets, industry, include current month, benchmark opt-in.
- **Digest:** "Monthly email a week before billing" toggle (`digestOptIn`), plus a "Preview next email" link (`/admin/digest/[org]` for admins; a modal preview for users if time allows).
- **Members:** list of people with access (name, email, role). Invites are out of scope for 1.0; show "Ask them to sign in with Xero".
- **Connection:** Xero org name, connected since, last refresh, "Refresh now", "Disconnect" (confirm dialog: "This removes our access and deletes your data within 24 hours.").

### 5.15 Billing `/app/[org]/billing`

- **Data:** `GET /api/billing/plans`, `GET /api/orgs/:org/subscription`.
- **Prices come only from the API. Never hard-code them** (they're confirmed after this spec is written).
- **Plan cards:**
  - Monthly (+ one-off audit)
  - Annual (audit included, highlighted as best value)
  - Audit only
  - A plan with `available: false` is hidden.
- **Choose a plan:** `POST /api/billing/checkout {planId}` → redirect to the returned Stripe Checkout URL.
- **Current plan:** status, renewal date, "Manage billing" → `POST /api/billing/portal` → redirect.
- **`design_partner` status:** "You're a design partner: free until launch. Thank you."
- **Success page:** "You're all set" plus the plan. **Cancel page:** "No charge made" plus "Back to plans".

### 5.16 Admin (internal, plain tables are fine)

- **`/admin/queue`:** open review items.
  - Filter by kind; oldest first.
  - Row: kind, business, reason, age.
  - Resolve form per kind: category picker, fingerprint confirm/reject, fact entry (value + source URL), or dismiss.
- **`/admin/fp`:**
  - Overall, per-rule and per-week rates: false positive, detection miss, data quality, not now.
  - Highlight any rate above the gate (15%).
- **`/admin/churn`:** monthly cohorts by plan.
- **`/admin/digest/[org]`:** renders the next digest HTML.

---

## 6. Components to build (shared)

- `Money`, `Percent`, `DateText`: formatting per §2
- `StateTag`: line states per §5.6
- `BandTag`
- `FactValue`: handles all five states
- `SampleTag`
- `EvidenceBlock`
- `FeedbackControl`
- `RecommendationCard`: with score breakdown
- `TrendCard`: sparkline + table toggle
- `StatementTable`: sections, rows, optional monthly columns, filters
- `SidePanel`: URL-synced, focus-trapped, Esc to close, full page under 768px
- `OrgSwitcher`
- `ShortlistDrawer`
- `Banner`
- `AppPicker`: search the catalogue, with free-text fallback
- `ProgressSteps`
- `EmptyState`, `ErrorState`: show message, retry, requestId
- `ConfirmDialog`

---

## 7. Accessibility, responsiveness, performance

- WCAG 2.2 AA:
  - visible focus
  - full keyboard use
  - side panel and drawers trap focus and return it on close
  - tables use real `<table>` markup with headers
  - charts have a table alternative
- Contrast ≥ 4.5:1 for text, including tags.
- 400px: tables become stacked rows (name + value + tag), and monthly columns scroll inside their container.
- Largest Contentful Paint under 2.5s on the overview with warm data. Statements render server-side.

---

## 8. API contract (`lib/api/types.ts`, source of truth)

```ts
// ---------- primitives ----------
export type Money = number;                     // GBP, 2dp
export type ISODate = string;                   // 'YYYY-MM-DD'
export type ISODateTime = string;
export type Band = 'high' | 'medium' | 'low';
export type LineState = 'flagged' | 'covered' | 'fine' | 'marked_fine' | 'queued' | 'snoozed';
export type FactState = 'verified' | 'found' | 'missing' | 'conflicting' | 'stale';
export type Lifecycle = 'new' | 'active' | 'lapsing' | 'inactive' | 'declared';
export type Market = 'UK' | 'US' | 'CA' | 'AU';
export type Industry = 'ecommerce' | 'saas' | 'other';
export type StatementKind = 'pl' | 'bs' | 'cf';

export interface ApiError { code: ErrorCode; message: string; retryable: boolean; requestId: string }
export type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION'
  | 'XERO_NOT_CONNECTED' | 'XERO_RATE_LIMITED' | 'XERO_CONNECTION_CAP' | 'XERO_UNAVAILABLE'
  | 'REFRESH_IN_PROGRESS' | 'BILLING_REQUIRED' | 'INTERNAL';

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
  connection: 'active' | 'revoked' | 'error'; sample: boolean;
}
export interface OrgSettings { markets: Market[]; industry: Industry | null; includeCurrentMonth: boolean; benchmarkOptIn: boolean; digestOptIn: boolean }

// ---------- refresh ----------
export interface RefreshRun {
  id: string; status: 'running' | 'ok' | 'partial' | 'error';
  startedAt: ISODateTime; finishedAt: ISODateTime | null;
  steps: { key: string; label: string; status: 'pending' | 'running' | 'done' | 'error'; detail?: string }[];
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
  key: 'debtor_days' | 'creditor_days' | 'stock_days' | 'cash_headroom_months';
  label: string; unit: 'days' | 'months';
  series: { month: ISODate; value: number }[];       // 12 month-ends
  latest: number; change3m: number; threshold: number;
  flagged: boolean; atStake: Money | null; band: Band | null; flagId: string | null; lineKey: string | null;
}
export interface Banner { kind: 'connection_revoked' | 'refresh_failed' | 'cashflow_unreconciled' | 'payment_failed' | 'sample' | 'connection_cap'; message: string; action?: { label: string; href: string } }

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
  key: string;                           // e.g. 'pl:477', 'trend:debtor_days'
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
  line: Line; statementKind: StatementKind | 'trend';
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
  reason: string; inUse: boolean; kind: 'add' | 'change' | null;   // null when inUse: the app already in use is shown, not recommended
}
export interface AppCard {
  id: string; name: string; categories: string[]; markets: Market[];
  price: FactValue<{ model: 'per_month' | 'per_user_month' | 'per_year' | 'quote' | 'usage'; fromGbp: number | null; note?: string }>;
  sample: boolean;
}

// ---------- feedback ----------
export type FeedbackAnswer = 'yes' | 'already_use_app' | 'no_app_needed' | 'numbers_wrong' | 'not_now';
export type SubReason = 'wrong_category' | 'figure_mismatch' | 'one_off' | 'miscoded';
export interface FeedbackInput { answer: FeedbackAnswer; subReason?: SubReason; appId?: string; appName?: string; note?: string }
export interface Feedback extends FeedbackInput { id: string; createdAt: ISODateTime; by: string }
export interface FeedbackResult { feedback: Feedback; line: Line; message: string }

// ---------- apps ----------
export interface DetectedApp {
  appId: string; name: string; category: string; spend12m: Money; monthsSeen: number;
  lastPaid: ISODate | null; cycle: 'monthly' | 'quarterly' | 'annual' | 'unknown'; state: Lifecycle;
}
export interface LifecycleQuestion {
  id: string; kind: 'lapsing' | 'replacement';
  appId: string; appName: string; lastPaid: ISODate | null;
  replacementAppId?: string; replacementAppName?: string;
}
export interface LifecycleAnswer { answer: 'still_using' | 'moved_to' | 'stopped' | 'is_replacement' | 'not_replacement'; movedToAppId?: string; movedToName?: string }
export interface AppDossier {
  app: { id: string; name: string; website: string; categories: string[]; markets: Market[]; sample: boolean };
  facts: Record<string, FactValue<unknown> & { group: 'price' | 'contract' | 'fit' | 'going_live' | 'security' | 'support' | 'vendor'; label: string }>;
  integrations: { toAppId: string; toName: string; kind: 'native' | 'via_app' | 'csv'; usedByOrg: boolean }[];
}

// ---------- essentials / shortlist ----------
export interface Essential { key: string; name: string; frequency: 'monthly' | 'quarterly' | 'yearly'; nextDue: ISODate | null; suggested: { appId: string | null; label: string }; covered: boolean }
export interface ShortlistItem { appId: string; appName: string; lineKey: string | null; lineName: string | null; price: AppCard['price']; addedAt: ISODateTime }

// ---------- billing ----------
export interface Plan { id: 'monthly' | 'annual' | 'audit_only'; label: string; priceGbp: number | null; interval: 'month' | 'year' | 'one_off'; auditIncluded: boolean; auditPriceGbp: number | null; available: boolean; highlight: boolean }
export interface Subscription { status: 'none' | 'active' | 'past_due' | 'cancelled' | 'design_partner'; planId: Plan['id'] | null; currentPeriodEnd: ISODate | null; cancelAtPeriodEnd: boolean }
```

### Endpoints

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/me` | – | `Me` |
| PUT | `/api/me` | `{ jobTitle }` | `Me` |
| POST | `/api/me/active-org` | `{ orgId }` | `Me` |
| GET / PUT | `/api/orgs/:org/settings` | `OrgSettings` | `OrgSettings` |
| POST | `/api/orgs/:org/refresh` | – | `RefreshRun` |
| GET | `/api/orgs/:org/refresh/:runId` | – | `RefreshRun` |
| GET | `/api/orgs/:org/summary` | – | `Summary` |
| GET | `/api/orgs/:org/statements/:kind` | `?months=12` (bs) | `Statement` |
| GET | `/api/orgs/:org/lines/:lineKey` | – | `LineDetail` |
| POST / DELETE | `/api/flags/:flagId/feedback` | `FeedbackInput` | `FeedbackResult` |
| GET | `/api/orgs/:org/detected-apps` | – | `{ apps: DetectedApp[]; questions: LifecycleQuestion[] }` |
| POST | `/api/orgs/:org/detected-apps/:appId/answer` | `LifecycleAnswer` | `{ apps; questions }` |
| POST | `/api/orgs/:org/detected-apps/declare` | `{ appId? , name? }` | `{ apps; questions }` |
| GET / PUT | `/api/orgs/:org/essentials` | `{ key, covered }` | `Essential[]` |
| GET / POST / DELETE | `/api/orgs/:org/shortlist` | `{ appId, lineKey? }` | `ShortlistItem[]` |
| GET | `/api/apps` | `?category&market&q` | `AppCard[]` |
| GET | `/api/apps/:id` | – | `AppDossier` |
| GET | `/api/billing/plans` | – | `Plan[]` |
| GET | `/api/orgs/:org/subscription` | – | `Subscription` |
| POST | `/api/billing/checkout` | `{ orgId, planId }` | `{ url }` |
| POST | `/api/billing/portal` | `{ orgId }` | `{ url }` |
| POST | `/api/waitlist` | `{ email, name, company, role, industry, consent }` | `{ ok: true }` |
| GET | `/api/auth/xero/start` | `?benchmarkOptIn&add` | 302 → Xero |
| POST | `/api/auth/logout` | – | 204 |
| POST | `/api/orgs/:org/disconnect` | – | 204 |

---

## 9. Analytics (privacy-friendly; PostHog EU or Plausible, no ledger values ever)

Events:
- `waitlist_joined`
- `connect_started`
- `connect_completed`
- `setup_completed`
- `line_opened`
- `feedback_given {answer, subReason}`
- `shortlist_added`
- `dossier_opened`
- `checkout_started {planId}`
- `checkout_completed`
- `lifecycle_answered {answer}`
- `org_switched`

**Never send** amounts, account names, org names or app spend.

---

## 10. Acceptance checklist (per screen, before handover)

- [ ] Every state in this spec reachable via a mock `?scenario=`
- [ ] Works at 400px and 1440px; light and dark (if designed)
- [ ] Keyboard only: can open a line, give feedback, add to shortlist, switch business
- [ ] No hard-coded prices or invented values; `null` / `missing` rendered as specified
- [ ] Sample tags visible on every sample item
- [ ] API errors show message + retry + requestId
- [ ] Types imported from `lib/api/types.ts` only

## 11. Out of scope for 1.0

- Monday digest for firms
- Practice home across clients
- Proposals
- Quote requests
- Peer price ranges
- Reviews and activators
- Member invites
- Vendor portal
- Dark mode, unless the design already includes it
