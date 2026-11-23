# ENGINE-V2.md: app database, scoring engine v2, dev engine panel, live Xero test scenarios, cleaner UI

> For Claude Code, in the FlowStack repo. Written 22 Nov 2026. Builds on `dev` at 09b5f32 (NEXT-STEPS P0–P2 done).
> Saved into the repo 22 Nov 2026 as received (owner). Build log: NOTES.md "Engine v2 build log".
>
> **Reading order:** CLAUDE.md → BACKEND.md → NOTES.md → NEXT-STEPS.md → this file. This file wins where they disagree on the items below. Log every decision and deviation in NOTES.md under "Engine v2 build log".
>
> **Paste this into Claude Code:**
> *"Read CLAUDE.md, BACKEND.md, NOTES.md, NEXT-STEPS.md and ENGINE-V2.md. Do Phase 0 and stop to show me the import report before anything else. Then build Phases 1–5 in order, committing per numbered item with lint, tests (two batches, --maxWorkers=2) and eval passing. Don't merge to main."*

---

## What we're building, in one paragraph

The owner has built a **Xero app database** (App Store categories, the Xero functions each app works with, descriptions, ratings, reviews, pricing tiers and Xero Awards). Engine v2 uses it to rank apps for each flagged line:

- It runs alongside v1 first ("shadow mode"), so we can compare the two.
- Every score comes with a full trace of how it was worked out.
- Admins in dev mode get a **frosted-glass Engine panel** floating over the app, which shows the whole calculation and can be minimised.
- Items waiting for a person show as a **pulsing review box** in a dev sidebar.
- We then create **test businesses with known problems in Xero**, connect them to FlowStack, and check live that the engine gives the answers we expect.
- Alongside this, the app gets a cleaner, more corporate look.

## Rules that still apply (CLAUDE.md §2)

- **Read-only Xero.** The product never asks for write scopes. Test data goes into Xero through Xero's own import screens (Phase 4), not through our app.
- **No AI/ML training.** Engine v2 is fixed rules and plain statistics, with weights written in YAML by people. Nothing learns from feedback automatically. What-if sliders in the dev panel are never saved.
- **Ranking only.** The new factors change the **order of recommended apps, never whether a line is flagged.** Flagging (coverage × materiality, `covered_by`) is unchanged, so the false-positive rate and eval gate aren't affected by this work. A test enforces it.
- **Never estimate.** A missing input scores neutral 0.5 and is shown as missing in the trace and the panel.
- **Sample data stays labelled.**

---

## Phase 0: find, check and import the app database (stop and report)

1. **Find it.** It isn't in the repo yet. Ask the owner for the file or folder, its format and where it came from. Then put it under `data/xero-apps/` with a `SOURCE.md` saying:
   - where each field came from (Xero App Store listing, Xero Awards page, vendor site, typed by hand)
   - the date it was captured
   - who built it
2. **Write an adapter** (`scripts/appdb/adapt.ts`) from the owner's format to the canonical schema below, validated by Zod. Reject rows that fail; never fill gaps.
   ```ts
   // catalog source of truth for v2 inputs → table xero_app_listings (migration 0025, global, read-only to the app role)
   {
     listing_id: string;              // the owner's id or App Store slug
     name: string;
     website: string | null;          // domain used to match apps.yaml
     xero_categories: string[];       // as Xero labels them
     xero_functions: string[];        // what the app reads/writes in Xero, as listed (e.g. "Invoices", "Bills", "Bank transactions", "Payroll", "Inventory", "Contacts", "Tracking categories")
     description: string | null;      // used for keyword matching only; never shown to customers
     rating_avg: number | null;       // 0–5
     rating_count: number | null;
     review_count: number | null;
     pricing_tiers: { name: string; price_gbp: number | null; period: "month" | "year" | "one_off"; unit: "org" | "user" | "employee" | "transaction" | "other"; included?: string; limits?: string }[];
     awards: { name: string; year: number; region: "UK" | "ANZ" | "US" | "global" | string; level: "winner" | "finalist" }[];
     markets: ("UK" | "US" | "CA" | "AU")[];
     source_url: string | null;
     captured_at: string;             // ISO date
   }
   ```
3. **Match listings to `catalog/apps.yaml`:** website domain first, then exact name, then fuzzy (≥ 0.93).
   - Unsure matches → queue item `appdb_match` for a person.
   - Listings with no catalogue app → report them. Don't auto-create apps; a person adds them to apps.yaml with `sample: true`.
4. **Map Xero's categories to ours** in `catalog/xero-category-map.yaml` (Xero label → our app category, many-to-many), plus a vocabulary of Xero functions in `catalog/xero-functions.yaml`. Typed by hand from the data; unknown labels are listed in the report, not guessed.
5. **Report** (`docs/appdb-import-report.md`):
   - rows read, accepted and rejected (with reasons)
   - matched and unmatched counts
   - field completeness per field
   - candidate apps per (our category × market)
   - unknown Xero categories and functions
6. **Terms check:** add an item to NOTES "Waiting on owner". The App Store descriptions, ratings and reviews come from Xero's site, so CLAUDE.md asks us to check the App Store terms before importing. Until the owner confirms:
   - descriptions are used **only** for keyword matching and appear only in the admin dev panel
   - ratings are shown only as numbers, attributed "Xero App Store, captured <date>"
   - no review text is shown

**Stop here and show the owner the report.**

---

## Phase 1: engine v2 (shadow mode, full trace)

### 1.1 Score structure
Keep the founder-decided top-level weights, and fill each part with the new data. Every number below lives in `catalog/rules.yaml → scoring_v2:`.
```
match = 100 × ( 0.50 × strength      # unchanged: coverage × materiality, normalised across the org's flags
              + 0.35 × fit           # integration fit with kept apps (as v1) + job fit (new)
              + 0.10 × quality       # replaces peer_results: App Store rating, review volume, Xero Awards
              + 0.05 × price )       # pricing tiers vs the business's size

fit     = 0.60 × integration_fit + 0.40 × job_fit
job_fit = 0.40 × category_match + 0.35 × function_match + 0.25 × keyword_match
quality = clamp( 0.85 × rating_score + 0.15 × volume_score + award_boost, 0, 1 )
```
**Owner decision:** the split inside `fit` and `quality` is a proposal. The top-level 0.50 / 0.35 / 0.10 / 0.05 stays as decided on 9 Nov. Put both in YAML and mark them PROPOSED in NOTES.

### 1.2 Each input (pure functions in `lib/rank/v2/`, one file each, each with fixture tests)

| Input | How it's computed | Missing → |
|---|---|---|
| `integration_fit` | v1 `fitWithInUse` (native 1.0, via app 0.8, CSV 0.6, none 0.3, no kept apps 0.5) | 0.5 |
| `category_match` | 1.0 if the app's mapped categories include the rule's `covered_by` category; 0.7 if only `app_categories`; 0 otherwise (and then it isn't a candidate) | – |
| `function_match` | Share of the rule's `required_functions` the app lists, plus 0.5 × share of `helpful_functions`, capped at 1. Add both lists to each rule in rules.yaml (e.g. payroll: required `[Payroll, Manual journals]`, helpful `[Employees, Tracking categories]`) | 0.5 |
| `keyword_match` | BM25 between the rule's `keywords` (rules.yaml, plus synonyms) and the app description, over all candidate descriptions in that category, scaled 0–1 by the top score in the set; stop-words removed. No embeddings | 0.5 |
| `rating_score` | Bayesian average `(n × R + m × C) / (n + m)` with m = `rating_prior_count` (20) and C = mean rating of apps in the same category; then `(bayes − 1) / 4` | 0.5 |
| `volume_score` | `log10(1 + review_count) / log10(1 + max review_count in category)` | 0.5 |
| `award_boost` | Sum over awards of `level_boost × 0.5^(years since award)`, where winner 0.10 and finalist 0.05; counts only awards in the business's region or global; capped at 0.15 | 0 |
| `price` | Pick the tier that fits the business: unit `org` → that tier; `user` / `employee` → tier price × headcount band midpoint, if known. Score = 1 if annual cost ≤ `price_share_good` (0.2%) of annual revenue, falling linearly to 0 at `price_share_bad` (2%). Quote-only or no tiers → missing | 0.5, "price not published" |

- **Ties:** use v1's tie-break (prefers apps that handle the line), then name.
- **The app already in use is always scored and shown** (`inUse: true`, `kind: null`).

### 1.3 Trace (the heart of the dev panel)
`lib/rank/v2/trace.ts` returns, for one flagged line:
```ts
type EngineTrace = {
  engine: "v1" | "v2"; rulesVersion: string; computedAt: string; orgId: string; lineKey: string;
  line: { name: string; value: number; materiality: number; band: string; ruleId: string; ruleVersion: number };
  weights: Record<string, number>;          // as used, after any what-if override (dev only)
  candidates: {
    appId: string; name: string; rank: number; match: number; inUse: boolean; kind: "add" | "change" | null;
    parts: { key: string; label: string; raw: unknown; normalised: number; weight: number; contribution: number;
             missing: boolean; source?: { label: string; url?: string; capturedAt?: string }; note?: string }[];
    formula: string;                        // the formula with this app's numbers filled in
  }[];
  excluded: { appId: string; name: string; reason: string }[];   // e.g. "not in UK market", "category doesn't match"
  warnings: string[];                       // e.g. "only 2 candidates for payroll in UK: catalogue gap"
};
```
- **API:** `GET /api/dev/engine/:org/:lineKey?engine=v1|v2&weights=<json>` returns the trace. It answers **404 unless dev tools are on and the user is an admin** (§2.1).
- **Shadow mode:** `ENGINE_VERSION=v1` (default) keeps v1 for customers. v2 is computed on every refresh and stored in `recommendations_v2` (same shape as `recommendations`, migration 0025), so the panel can compare them. Flip to v2 only after Phase 5 passes and the owner agrees.

### 1.4 Complete recommendations
- **Every flagged line returns at least 3 candidates**, or a visible warning plus a queue item `catalog_gap` naming the category and market.
- `pnpm engine:coverage` prints:
  - candidates per (category × market)
  - v2 field completeness for each candidate
  - which rules have no `required_functions` or `keywords` yet
- **Tests:**
  - v2 never changes a line's flag state
  - missing inputs give 0.5 and `missing: true`
  - the contributions in the trace add up to the match (±0.01)
  - award decay
  - the Bayesian prior pulls a 5.0 rating from 2 reviews below a 4.6 from 400
  - price tiers per unit type

---

## Phase 2: dev tools (Engine panel, dev sidebar, review alert)

### 2.1 Who sees it
- **Dev tools are on** when `DEV_TOOLS=true` (env) **and** the signed-in user's email is in `ADMIN_EMAILS`.
- **Never** shown to customers, testers, demo guests or the public.
- The server checks this on every dev route. The client only hides and shows.
- `DEV_TOOLS` can be on in production for admins only.

### 2.2 Dev sidebar (left rail, dev tools only)
- A slim left rail on every `/app/[org]` page and admin page. The normal top nav stays.
- **Items:**
  - Engine (toggles the panel)
  - **Review queue** with a count
  - User reports
  - Testers
  - Debug (this business)
  - Scenario checks (Phase 4)
- **The review box pulses** while open items exist:
  - a soft glow cycle of 1.6 s; amber for normal, red for high priority
  - the count is always shown as a number too
  - with `prefers-reduced-motion`, a steady badge instead of the pulse; never flashes faster than 3 times a second
- Hover or click opens a short list of the 5 oldest items (kind, business, age), each linking to `/admin/queue?item=`.
- **Polling:** `GET /api/admin/queue/summary` (counts by kind and priority) every 30 s while the tab is visible.
- **Lines needing a person:** in dev tools, `queued` lines and lines with an open `flag_disputed` or `account_mapping` item get a visible "Needs a person" outline and badge on statements and the line page.

### 2.3 Engine panel (frosted glass, minimisable)
- **Placement:**
  - Floats over the page, docked right: 440 px wide, resizable from 360 to 720, full height minus 24 px.
  - Minimised, it becomes a small pill at the bottom right ("Engine · v2 · 4 flags").
  - Toggle with the rail button or **Ctrl+Shift+E** (⌘⇧E on Mac).
  - Open/minimised state, width and active tab are remembered in `localStorage` (wrapped in try/catch; falls back to minimised).
- **Glass look** (tokens in the theme file):
  - background `rgb(255 255 255 / 0.72)` in light, `rgb(17 24 39 / 0.62)` in dark
  - `backdrop-filter: blur(16px) saturate(140%)`
  - 1 px border at 8% ink, radius 12 px, a soft large shadow
  - where `backdrop-filter` isn't supported, a solid surface
  - text contrast checked at ≥ 4.5:1 on the glass
- **Context:**
  - On a line page it shows that line.
  - Anywhere else in a business, a line picker listing the flagged lines (largest £ first).
- **Tabs inside the panel:**
  1. **Ranking:** candidates in order, each with total match and a stacked bar of the four weighted parts. In-use apps are marked; excluded apps are listed under a fold with reasons.
  2. **Breakdown** (selected app):
     - the formula with numbers filled in
     - a table of every input: raw value → normalised → weight → contribution, with a source link and captured date
     - missing inputs highlighted
     - a waterfall from 0 to the final match
  3. **v1 vs v2:** both rankings side by side with rank moves (↑2, ↓1) and the main reason for each move.
  4. **What-if:**
     - sliders for the top-level weights and the sub-weights
     - re-ranks instantly on the client from the trace
     - "Reset" restores the YAML values
     - labelled "Experiment: not saved"
     - "Copy as YAML" for proposing a change in a PR
  5. **Data:**
     - the app database record for the selected app: fields, completeness, source and date, Awards
     - descriptions shown here only (admins)
  6. **Queue:** open review items for this business, linked.
- **Export:** "Download trace (JSON)" for the current line.
- **Accessibility:** a labelled `role="complementary"` region; focus moves into the panel on open and returns on minimise; Esc minimises; keyboard reachable.

---

## Phase 3: cleaner, corporate look (whole app)

The owner wants the deployed app to look cleaner and more corporate, moving away from black and white with yellow highlights.

- **Change tokens and shared components only.** The designer's later proposals can still replace them in one place. Update CLAUDE.md §1's visual system to match, with a note: "Owner restyle 22 Nov 2026; designer may revise".
- **Type:**
  - **Inter** (variable, via `next/font`) for headings and body, with `font-feature-settings: "tnum" 1, "cv11" 1` on figures
  - **IBM Plex Mono** only for account codes and IDs
  - Drop Archivo wide
- **Scale:** 32/40 page title (600), 20/28 section (600), 15/22 body, 13/18 small, 12 labels in uppercase with 0.04em tracking.
- **Theme:** light by default; dark via a settings toggle (stop following the system automatically).
- **Light tokens** (`app/globals.css :root`; dark equivalents under `[data-theme="dark"]`):
  ```css
  --bg:#F7F8FA; --surface:#FFFFFF; --surface-2:#F2F4F7; --border:#E4E7EC; --border-strong:#D0D5DD;
  --text:#101828; --text-2:#344054; --muted:#667085;
  --primary:#1D4ED8; --primary-soft:#EFF4FF;          /* actions, links, selected tab */
  --success:#067647; --success-soft:#ECFDF3;          /* covered, connected, verified */
  --warning:#B54708; --warning-soft:#FFFAEB;          /* checking, needs a person, lapsing */
  --danger:#B42318;  --danger-soft:#FEF3F2;           /* errors, high priority */
  --radius:8px; --shadow-1:0 1px 2px rgb(16 24 40 / .06); --shadow-2:0 8px 24px rgb(16 24 40 / .10);
  ```
- **Status tags:** soft fill and dark text, always with words:
  - "Look at this" → warning-soft
  - "Covered" → success-soft
  - "Fine" → neutral
  - "Checking" → warning outline
- **The £ at stake** uses the primary colour, not a highlighter.
- **Layout:** cards on `--surface` with `--border` and `--shadow-1`; 24 px gaps; max width 1200 px; tables with 44 px rows and a sticky header.
- **Checks:** both themes; axe clean; the existing 400 px test still passes (even though the product targets laptops); no hex values outside the tokens file (add a test).

---

## Phase 4: test businesses with known problems (offline first, then live in Xero)

### 4.1 Scenarios
Each scenario is invented, labelled sample, and built to trigger specific behaviour. UK, financial year ending 31 March, 13 months of history.

| ID | Story | Must produce |
|---|---|---|
| S1 `ecom-no-stock` | Shopify + Amazon seller, growing stock, no inventory app | Cost of sales and inventory flagged high; stock-days trend; inventory apps ranked (e.g. Cin7, Unleashed, Katana if in the database); A2X or Link My Books where sales channels apply |
| S2 `saas-debtors` | Stripe subscriptions, debtor days rising 38 → 55, no collections app | Receivables + debtor-days trend flagged; collections apps ranked (e.g. Chaser, GoCardless) |
| S3 `payroll-journals` | Payroll posted by monthly manual journals, Deputy paid | Wages, NI and pensions flagged; payroll apps that work with Deputy rank first; Deputy shown as in use |
| S4 `well-covered` | Dext, Pleo and a payroll app all paid monthly | **No flags** on covered lines (false-positive check) |
| S5 `one-off-legal` | A single £40k legal bill in one month | One-off note and band drop on that line |
| S6 `lapsing-pleo` | Pleo paid monthly, stops in month 11, later bills entered | "Still using Pleo?" question; Pleo still counted as cover |
| S7 `miscoded-software` | Software bills posted to General Expenses | Mapping or data-quality behaviour as built; nothing wrongly flagged high |
| S8 `unknown-supplier` | Monthly bills from an unrecognised software vendor | `unknown_supplier` queue item; the rail's review box pulses |

### 4.2 Generator
`pnpm scenarios:build` → `scenarios/<id>/` containing:
- **`xero-import/`:** CSV files ready for Xero's own import screens:
  - contacts
  - chart of accounts additions
  - sales invoices
  - bills (app subscriptions as authorised bills from suppliers named like the real vendors, so fingerprints match)
  - manual journals (payroll, stock, opening balances)

  **Column headers must match Xero's current import templates exactly:** download each template from Xero into `fixtures/xero-import-templates/` and generate from those headers; don't guess them.
  - Use bills, not bank statement lines, for app spend. Imported statement lines only become bank transactions once reconciled.
- **`fixtures/`:** the same data shaped as Xero API responses, so `XERO_MODE=fixtures` runs the scenario offline through the real pipeline (extend `scripts/make-synthetic.ts`).
- **`expected.yaml`:** the golden answers:
  - lines that must be flagged (with minimum band)
  - lines that must **not** be flagged
  - top-3 app sets per flagged line (order optional unless stated)
  - expected queue items
  - expected lifecycle questions
  - minimum candidates per flag (3)
- **`README.md`:** the story and the numbers.

### 4.3 Checks
- **Offline:** `pnpm scenario:offline <id|all>` runs the pipeline on fixtures, compares with `expected.yaml`, and prints pass/fail with the v2 trace for any failure. It runs in CI.
- **Live:** `pnpm scenario:check <id> --org <orgId>` reads the connected business's latest run from the database (admin connection) and compares the same way. It is also on the dev sidebar as "Scenario checks" (choose scenario + business → result table, link to the Engine panel for any failing line).

### 4.4 Live runbook (`docs/LIVE-TEST.md`, steps the owner does in Xero)
1. Create a fresh **Xero trial organisation** per scenario (UK, financial year end 31 March), so the Demo Company's own data doesn't mix in.
   - Xero's Demo Company can be used for quick checks, but expected results won't be exact.
   - Xero's free plan for FlowStack allows **5 connected businesses in total**, so disconnect old test businesses first.
2. In Xero, import in this order: chart of accounts → contacts → manual journals (opening balances) → bills → sales invoices → monthly journals. Approve the bills if they import as drafts.
3. In FlowStack, connect the business (invite code if `ACCESS_MODE=invite`), wait for the refresh, then run "Scenario checks" and open the Engine panel on each flagged line.
4. Record the results in `docs/live-test-results.md`:
   - pass/fail per scenario
   - differences between live and offline (these usually mean a parsing or mapping problem)
   - screenshots of the panel
5. Disconnect the test business when done.

---

## Phase 5: decide and switch

- When all 8 scenarios pass offline and live, and `pnpm eval` passes, **write a short comparison** in NOTES of v1 vs v2 rank changes per scenario.
- **The owner decides** whether to set `ENGINE_VERSION=v2`.
- Keep v1 code for one release, then remove it.

---

## Migrations (read every generated migration before committing)
- **0025:**
  - `xero_app_listings` (global)
  - `recommendations_v2`
  - review-queue kinds `appdb_match` and `catalog_gap`
- No changes to tenant data shapes beyond these.

## New env vars
```
DEV_TOOLS=false            # true + ADMIN_EMAILS user → dev rail, Engine panel, /api/dev/*
ENGINE_VERSION=v1          # v1 | v2 (customers); v2 is always computed in shadow
```

## Waiting on the owner (log in NOTES)
1. Where the app database file is, its format and sources.
2. OK to use App Store descriptions and ratings under Xero's App Store terms (scoring and admin panel only until confirmed).
3. The proposed weights inside `fit` and `quality`, and the award boost (winner 0.10, finalist 0.05, halving each year, capped at 0.15).
4. Whether to switch customers to v2 after Phase 5.
5. The restyle replaces the CLAUDE.md §1 visual system until the designer's proposals arrive.

## Done when
- [ ] Import report reviewed by the owner; listings matched or queued; no guessed values
- [ ] v2 computed for every refresh in shadow; traces add up; v2 never changes flag states (test)
- [ ] Every flagged line has 3 or more candidates, or a visible catalogue-gap warning plus a queue item
- [ ] Engine panel works on every business page for admins with `DEV_TOOLS=true`, and is 404 for everyone else
- [ ] Review box pulses with open items and respects reduced motion
- [ ] New look applied through tokens; both themes; axe clean; no stray hex values
- [ ] 8 scenarios pass offline in CI; live runbook done for at least S1–S4 with results recorded
- [ ] lint, tests and eval green; NOTES updated; nothing merged to main
