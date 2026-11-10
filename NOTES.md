# NOTES.md — local deviations and decisions

Things that differ from CLAUDE.md / BACKEND.md, and why. Keep this short and current.

## Dev environment
- **No Docker on the dev machine.** When `DATABASE_URL` is empty the app uses embedded Postgres
  (PGlite, real Postgres compiled to WASM) in `./.pglite`. Tests use an in-memory PGlite per file.
  `docker-compose.yml` is still provided; set `DATABASE_URL` to use it. Neon uses the same code path (postgres-js).
- **RLS mechanism.** The app connects as the table owner; `withOrg()` sets `app.org_id` and does
  `SET LOCAL ROLE flowstack_app` inside the transaction, so policies apply. Admin/queue/system code
  uses the owner connection without the role switch (equivalent to the spec's BYPASSRLS role).
  `review_queue`, `audit_log` and `users` are not granted to `flowstack_app` at all.
- Versions: Next 16, React 19, TypeScript 6.0 (7.x breaks typescript-eslint peers), ESLint 9, Zod 4, Drizzle 0.45.

## Fixtures
- `fixtures/xero/demo-uk-synthetic/` is **hand-built** in Xero's exact JSON shapes, labelled `sample`.
  It exists so every milestone can be tested before a real Xero app exists. The spec's "real Demo Company
  JSON" fixtures (`fixtures/xero/demo-uk/`) come from `pnpm xero:record` once XERO_CLIENT_ID/SECRET are set.
  Parser tests run against whichever sets are present.

## Schema additions beyond §12
- `orgs.include_current_month`, `orgs.sample`; `sync_runs.steps` (per-step progress for the refresh endpoint);
  `statements.totals`; `statement_lines.line_key`, `statement_lines.category`;
  `recommendations.org_id` and `flag_feedback.org_id/rule_id/rule_version` (RLS + FP traceability);
  `detected_apps.present`.

## Behaviour decisions (M2–M5)
- **grant_key on xero_connections.** One Xero authorisation can cover several tenants with a single rotating
  refresh token. Rows from the same grant share `grant_key`, refresh together under one advisory lock, and
  disconnecting one only revokes the refresh token when no sibling is still active.
- **Queue writes happen after the tenant transaction commits** (`enqueueAll`). The queue is owner-only, and
  writing it from inside `withOrg` both deadlocks single-connection PGlite and could leave queue items for
  rolled-back work.
- **If-Modified-Since is a probe, not a delta.** Aggregates can't be patched (the rows are gone), so when the
  probe shows changes the 12-month spend window is rebuilt in full; when nothing changed, the full pull is skipped.
- **Fingerprints:** exact by default; a trailing ` *` opts a pattern into token-prefix matching. Short or
  ambiguous names ("float", "wise") stay exact-only.
- **"Kept apps" for fit** exclude Xero itself and `other_software` (Google, Microsoft, Slack), otherwise every
  app with a Xero integration would score 1.0.
- **recompute(orgId)** rebuilds categories → cash flow → flags from stored rows, no Xero calls. M6 uses it
  after a review item is resolved.
- The open balance sheet is stored as a second `bs` statement in the run; "latest BS" = max(period_to).
- `/api/dev/login` exists only when XERO_MODE=fixtures and NODE_ENV≠production.

## Known risk to watch (FP rate)
On the synthetic set 19 of 52 lines flag. Per the spec, an in-use app that doesn't integrate with the other
kept apps is outranked → gap 0.5 → still flagged (e.g. Pleo loses to ApprovalMax on card-spend lines because
ApprovalMax connects to Dext). That's faithful to §8.3 but is the most likely source of "Not a problem"
answers; M7's labelled set should measure it.

## M6–M7 decisions
- **Flags upsert on (run_id, line_key).** Recompute used to delete + reinsert flags, which cascaded away
  users' feedback and changed flag ids under the UI. Flag ids are now stable within a run.
- **Fingerprint confirmations** from the queue are stored as exact-name rows in the DB `fingerprints` table and
  merged with catalog/apps.yaml at detection time. They are global (all orgs benefit on their next refresh).
- **Accepting an unreconciled cash flow** writes `cashflow_acceptances(org, period_to, diff)`. It only applies
  while the unexplained amount is unchanged (±£1); a different gap needs a fresh look.
- **Feedback:** "no" → line_override (marked_fine) + flag_disputed item; "yes" removes an earlier override.
  FP report uses each flag's latest answer.
- **Labelled set** (`fixtures/labelled/`, built by `scripts/make-labelled.ts`) has DRAFT labels written by Claude
  from the business story — a person must review them before the gate is trusted.

## Eval result 2026-11-04: gate FAILS (61.9% FP vs 15%)
All 26 FPs are card_spend / supplier_bills lines where the right app is already paid for (Pleo, Dext) but §8.3
ranks a better-integrated alternative above it → gap 0.5 → flagged. Payroll, stock, receivables: 0% FP, 0% missed.
**Resolved same day (owner approved): coverage rule v2.** Rules gain `covered_by` (categories that actually do the
job; payroll → [payroll], stock → [inventory]). An in-use app there covers the line; a higher-ranked same-job app
becomes `evidence.switch_option`. All rules bumped to v2. Eval: 0% FP, 0% missed, 100% state agreement on 155
lines — on 3 sample orgs with Claude-drafted labels, so treat as "matches the story", not proof. BACKEND.md updated.

## M8 decisions (2026-11-04)
- **Seeded facts are `missing` (sample: true), never invented values.** `pnpm db:seed` writes one row per app × field.
  Crawler facts are real observations, so they carry `sample: false` even while unverified.
- **Extraction = regex rules (always) + claude-haiku-5-5 structured output (only when LLM_ENABLED).** The LLM sees
  vendor marketing pages only, never ledger data. Every fact from either path must pass the verbatim quote check.
- **One `fact_missing` item per app** (ref = app + sorted missing fields), not one per field, to keep the queue usable.
- **Spot checks:** 20% of new/changed `found` facts. **>30% numeric move** or **pages disagreeing** → `conflicting`,
  last value kept. A `verified` fact is never downgraded by the crawler; it only goes `stale` after 90 days.
- **All pages failing = no information.** Facts are not touched (the first version re-confirmed them — fixed).
- Queue resolution gained `verify {field, value, source_url}` for fact_* items → state `verified`, checked_by = person.

## Live crawl, 3 apps (2026-11-04)
- Staffology: 3 pages fetched, 0 facts — prices not in the page text.
- Dext: `data_location = EU` found ("data is stored in the EU", dext.com). `/pricing` 404 — **crawl path needs a person**.
- Pleo: `/en-gb` paths 404 → corrected to `/en`. Pages fetch, but prices are client-rendered (JSON in the HTML; Readability
  text has no £). Correctly recorded as missing. **Set TAVILY_API_KEY** (renders JS) to get most pricing pages.
- Crawl paths in catalog/apps.yaml are hand guesses for every other app; expect more 404s until a person checks them.

## M9 (2026-11-04) — deploy-ready, not deployed
- Added: vercel.json (migrate on build, crons), Sentry via instrumentation.ts with every `dataCollection` option off
  (no headers, cookies, bodies, query strings — the OAuth code is in one — or stack-frame variables),
  outputFileTracingIncludes for catalog/*.yaml (verified in .nft.json), deploy guards (`missingForDeploy`, health
  `missing`, openDb refuses PGlite on Vercel), postgres-js tuned for serverless, `pnpm deploy:check`, /app/[org] landing page.
- **Deployed (4 Nov 2026):** Neon project FlowStack `round-mouse-47017658` (eu-west-2, branch `production`), linked with
  `neon init`/`neon deploy` (neon.ts declares Postgres only; Data API and Neon Auth deliberately off — server-only DB
  access, own Xero sign-in). Vercel project flow-stack1/flowstack, live at https://flowstack-xi-ten.vercel.app, health
  ok with `missing: []`, XERO_MODE=fixtures. Env set by `scripts/vercel-env.sh` (owner-run; per-environment secrets).
  Kept postgres-js: Neon's HTTP driver can't run the transaction + `SET LOCAL ROLE` RLS pattern.
- `.env.local` now points local dev at Neon; blank DATABASE_URL to go back to PGlite. Run `DOTENV=.env.local pnpm deploy:check`.
- **Still open:** Xero app creds → XERO_MODE=live and the Demo Company connect check; Preview has no APP_URL and shares
  the production Neon branch — give it its own branch before real customers connect.
- **Live-data fix (6 Nov 2026):** real Xero balance sheets tag "Current Year Earnings" with the placeholder account id
  `abababab-abab-abab-abab-abababababab`; the synthetic fixture didn't. The parser now treats it as no account, so
  `buildBS` reads CYE into totals and the cash flow cancels the prior-year earnings roll into retained earnings.
  Demo Company (UK) now reconciles exactly (CFO 6,684.76 / CFI −2,583.33 / CFF 0 = Δbank 4,101.43); regression test in
  tests/cashflow-live-shape.test.ts. Also: functions pinned to lhr1 (next to Neon), refresh route maxDuration 300.
- **Queue auto-close (6 Nov 2026):** a refresh whose cash flow reconciles closes the open `cashflow_unreconciled` item
  for that period (`autoClose`: status done, assignee/actor `system`, `resolution.auto = true`, audit row
  `queue.done.*`). If the problem returns, `enqueue` reopens only items with `resolution.auto` (audit
  `queue.reopened.*`); items a person accepted or dismissed stay closed.
- **Refresh button (6 Nov 2026):** `/app/[org]` has "Refresh from Xero" (components/refresh-button.tsx) and "Last
  refreshed". One refresh per org at a time: partial unique index `sync_runs_one_running` (migration 0005);
  `runRefresh` closes runs still `running` after 5 min as abandoned, then a clashing insert → `RefreshBusyError` → 409.
  Also fixed mis-encoded "Â£"/"Â§" in lib/read/views.ts (summary API label).
- **Preview DB (6 Nov 2026):** Neon branch `preview` (br-shy-sun-za9iz0jm), tenant data cleared, catalogue kept. Vercel
  Preview points at it via `scripts/vercel-preview-db.sh`. Details in DEPLOY.md "Neon branches per environment".

## Readable pages (6 Nov 2026)
- Server-rendered pages replace the JSON links: `/app/[org]` (summary + lines worth a look), `/app/[org]/statements/{pl,bs,cf}`, `/app/[org]/lines/[lineKey]` (cause, evidence, apps in use, ranked apps, "Is this right?").
- Built without the prototype (not in the repo); visual tokens follow CLAUDE.md §1. Swap in the prototype's design when it turns up.
- Plain CSS in app/globals.css, not Tailwind (CLAUDE.md §4) — small surface, no new dependency. Revisit with the prototype port.
- Prices still hidden; catalogue apps tagged "draft entry"; sample orgs tagged "sample data".

## Stack map (6 Nov 2026)
- `/app/[org]/map`: Xero in the middle, each app category (finance job) around it, from the latest run. Built from
  CLAUDE.md §1.3 + the "client money flow" notes; no prototype, so the layout is mine.
- Each line belongs to one job: its rule's first `covered_by`, else first `app_categories` (payroll lines → Payroll, not Rota).
  Cash flow lines are left out (they restate balance-sheet movements).
- £ per job uses the summary's at-stake rule (flagged P&L cost lines), so the jobs add up to the hero figure.
- Status: gap (flagged, no app) · part by hand (app reaches Xero by CSV, or app in use but lines still flagged) ·
  connected · being checked (only queued lines) · quiet (listed in one line, not drawn).
- Fixes in order: "fix" items (apps already paid for) before "add" items, then by £, then by flagged-line count.
  No dependency graph beyond that yet.
- Links to Xero come from catalog/apps.yaml integrations, which are unverified (said on the page).

## Catalogue to 79 apps + directory and dossier pages (6 Nov 2026)
- **Owner decision (deviation from CLAUDE.md §2.4 "no scraping of competitors"):** Mayday's public CFO Techstack
  map was read ONCE, for app names only, as a checklist. Nothing else was taken from it: no descriptions, ratings,
  categories-per-app or prices. Names were typed into catalog/apps.yaml by hand. Do not re-read it for anything else.
- 49 apps added (33 from that checklist, 18 UK Xero apps we chose; Derive skipped: no vendor site found; Pento skipped:
  redirects to HiBob; Mayday/Easy Month End skipped: month-end tools, no matching finance job). 79 total, 75 in the
  directory (Xero + 3 general software excluded). Compliance and FP&A now have apps.
- Every website, crawl path and Xero link was checked on the vendor's own site with FlowStackBot (honest user agent,
  robots.txt respected) via `pnpm crawl:probe`. `to: xero` is set only where the vendor's own page mentions Xero
  (a proxy, not proof). Calxa and Revolut block bots → no Xero edge, "needs a person".
- Markets and categories are our own hand entries; all sample: true.
- Crawl on the preview branch, rules extractor only (no TAVILY_API_KEY, no ANTHROPIC_API_KEY): 23/49 apps gave at least
  one fact; 8 have a £ price. Many pricing pages are USD or client-rendered. Some regex prices are add-ons, not the
  main plan (Stripe "£7/month") — they stay `found` (unverified) and go to spot checks.
- `/apps` (public directory, alphabetical per job, never ranked) and `/apps/[id]` (dossier grouped as §7.3b: price,
  contract, fit with Xero, security, support; each fact shows quote, source link and date; peer prices say "not
  enough peers yet" until k ≥ 10).
- Production facts fill in on the monthly crawl (1st, 03:41) or `pnpm crawl` with production env.

## Rest of the spec, no Stripe (7–8 Nov 2026)
- **Owner instruction:** "continue building, leave Stripe, address the rest of the spec". Stripe is paused (the owner
  is rethinking billing). This overrides BACKEND.md §18's "keep the seams, don't build yet" for the items below.
- **E2E (CLAUDE.md §10):** `pnpm test:e2e` (Playwright, installed Chrome). Throwaway `.pglite-e2e` DB with every DB
  variable overridden; own build dir (`NEXT_DIST_DIR=.next-e2e`). Covers connect → diagnosis → recs → map, install →
  After install, settings, Ask, practice → proposal by link, and the 400px light/dark check on every page.
  The 400px check found two real overflows (P&L status badges; proposal fixes list), both fixed.
- **DB handle on globalThis** (lib/db/client.ts): the Next dev server bundles route handlers and pages separately, so
  each loaded its own PGlite copy and pages couldn't see route writes. Neon was never affected.
- **Check-ins (§7.6):** installs + checkins. Reports-first means we judge from bills and line states, not the app's own
  sync: day 7 "bills reaching Xero", day 30 "line now handled", day 90 "still flagged? before/after figure",
  renewal −60 "price vs peer range". Detected installs: a recommended app whose first bill is in the last 2 months.
  Nightly cron judges due check-ins, refreshing at most 5 stale orgs a night. No adoption target exists in 1.0
  (needs volumes, D7), so the after-install chart shows monthly bills only.
- **Peer prices (§7.3b #1):** opt-in (`orgs.share_prices`, default off: the spec says consent; owner may want to
  revisit the default with the terms page), sample orgs excluded, k ≥ 10 distinct businesses, asker excluded from its
  own comparison, size band from annualised revenue. `price_observations` has RLS on with no grant (owner only).
  Xero terms clause 29 forbids supplying aggregated user data to a third party; these ranges are shown only inside
  FlowStack. Have the owner/legal confirm that reading.
- **Verified reviews (§7.5, DMCC):** 2+ months of the app's bills; tenure badge; every submit/edit queued
  (`review_moderation`: publish, or reject with a reason, never dismiss, never for negativity); RLS lets the app role
  insert only pending, non-incentivised rows; sample orgs never queued or public; full audit_log; 90-day support
  re-rate; vendor replies entered by an admin. Incentive ("1 month of Pro") NOT built: it depends on pricing (paused).
  The 90-day follow-up is an in-app prompt; email needs a provider (owner). Check current CMA guidance before launch.
  `peer_results` in ranking = mean review score from 5+ published reviews (90-day support preferred), else neutral.
- **Practice plan (§1 Firm UX):** firms, firm_members, firm_orgs, firm_invites, playbooks, proposals (all owner-only
  tables). `requireOrgMember` now also admits members of a firm that has the client. Clients are added one at a time
  by someone who connected that org (Bulk Connections is Advanced-only). Practice home ranks clients by £ at stake
  (hours are out of 1.0, D7), 5-segment flow bar (sales ← EPOS; payroll ← payroll + rota; purchases ← data capture +
  spend + inventory; collections ← billing; payments ← FX/banking), filters, playbook drift, ask across clients.
  Proposals: firm-branded public link (unguessable token, 30 days, noindex), client ticks fixes and sees £ at stake
  (not "time back": needs volumes). Monday digest is a page; email/Slack delivery needs a provider (owner).
  Colleague invites are single-use join links (sign-in stays Xero; no email magic links yet).
- **Ask (§7.4):** keyword + job retrieval from the catalogue; rules answer always. Written answer only with
  LLM_ENABLED + key + per-org opt-in (`orgs.ask_ai`) because Xero terms 7(b)(ii) need the user's consent to pass API
  data to a third party (re-read 8 Nov 2026). Prompt = industry, size band, markets, app names, job keys that need a
  look; no amounts, account names or other supplier names (tested). Points must cite allowed ids or are dropped.
  claude-opus-5-5 with structured output; logs token counts only. Ask across clients is rules-only.
- **KPIs (BACKEND §18):** gross margin, staff costs share (wages, employer NI, pensions, other staff; not
  contractors), net profit share on the summary page. Null when the accounts aren't there.
- **Priority presets (§7.3b):** Balanced / Lowest cost / Fastest live / Best support on each line page, using the
  spec's weights over: standard match, published price, published days to go live, verified-review support (3+).
  Unknowns are neutral (0.5) and say so. Must-have questions are not built (need a situation form; quote requests
  collect sites/headcount/must-haves but don't filter ranking yet).
- **Quote requests (§7.3b #3):** situation only (industry, size band, markets, sites, headcount, apps kept,
  must-haves, reply-to email the user types), shown to the user before sending. `quote_request` queue item → our team
  emails vendors (`mark_sent`) and enters replies (`POST /api/admin/quotes/:id/replies`). Median response time per
  vendor on app pages from 3+ replies.
- **Not buildable here (owner):** Xero App Store listing/certification, Core/Plus plan, QuickBooks (needs an Intuit
  developer app), email/Slack provider, Stripe decision, terms/consent wording, CMA check, §11 open questions.

## First live connect: Jenki Drinks (7 Nov 2026), and owner review notes (9 Nov 2026)

- **What failed.** Xero consent, token exchange and all 6 report calls succeeded. The run then failed saving
  `statement_lines` (7 attempts, same step). The stored error was drizzle's "Failed query: …" text cut at 300/500
  characters, so the database's reason was lost.
- **Fixes (on dev):**
  - The report parser accepts only GUID-shaped account ids. Placeholders and anything else become computed rows.
  - Summary rows never become lines. An account on two rows becomes one line, with the rows added together, so
    the (statement, line) primary key can't clash.
  - `lib/sync/error-text.ts` stores and logs the Postgres code, message and detail. It never stores the SQL or its
    parameters, which are ledger values; `lib/api.ts` was logging them in full.
  - The refresh button re-reads the page while a server-side refresh is running, so it comes back without a tab switch.
- **The real cause is not yet confirmed.** If the next live refresh still fails, the stored error now names it.
- **Owner decisions in the review:**
  - Stripe for billing.
  - "Add & change", never "drop".
  - Audience: the finance team (FD, financial controller, finance manager, head of finance), not just the FD.
  - E-commerce and SaaS first.
- **Waiting on owner:** see the reply in the session log of 9 Nov.
  - Weights split (0.05 or 0.1 each).
  - Add vs fix preference.
  - Definition of "Not a problem" reasons.
  - Drop-off rule for apps that stop billing.
  - Pricing and margins.

## v1.1 build log (9 Nov 2026)

- **K + F (ff12752):**
  - Weights are 0.50 / 0.35 / 0.10 / 0.05, read from rules.yaml.
  - `recommendations.kind` is `add` or `change` (null for the in-use app).
  - Stack map steps are Add or Change, ordered by £ only. A function whose in-use app is still the best match gets no step.
  - Proposals drafted before v1.1 may still carry "fix".
- **G:** `PEER_PRICES_ENABLED` (default off).
  - Off means nothing is recorded (existing rows are deleted on the next refresh), nothing is shown on the dossier, and the settings opt-in is hidden.
  - The renewal check-in gets no peer band, so it says so.
- **H:** `MONDAY_DIGEST_ENABLED` (default off). The tab is hidden and the page returns not found.
- **A:**
  - `users.job_title`, asked once on the home page (Skip is remembered as `not_given`).
  - Review roles gain "Financial controller" and "Head of finance".
  - Industry `saas_tech` is renamed `saas` (migration 0013), and ecommerce and SaaS are listed first.
- **I:**
  - `/api/me`, `/api/me/orgs`, `/api/me/active-org`, and the session's `activeOrgId`.
  - A switcher in the org header when the user has 2+ businesses.
  - `XERO_CONNECTION_CAP` (default 5) is checked before OAuth (→ `/connect/limit`) and in the callback: new tenants over the cap are skipped, and reconnecting always works.
  - **Deviation:** firms link to clients through the existing `firm_orgs` table (many-to-many) rather than `orgs.firm_id`. It's the same grouping, and a client can sit with more than one firm.
- **M:**
  - `catalog/reporting-codes.yaml` holds only codes seen on Xero's real UK Demo Company. Broad codes (EXP, ASS, LIA, REV) are left out: a live UK chart had 96 accounts tagged just "EXP" and 117 just "ASS", so names + type + tax carry most real charts.
  - `catalog/account-synonyms.yaml`. The spec's `agency_staff` is our `contractors` key.
  - `accounts.tax_type` and `reporting_code_name` (migration 0015).
  - Tax checks: wages-like + VAT → contractors at 0.70 (queued), or at 0.80 when also named agency/contractors. Otherwise a category with `expected_tax` that disagrees loses 0.15.
  - Cost of sales now uses `type_default` (0.76) so a specific name beats "any direct cost". Direct wages map to wages.
  - There are 3 synthetic charts in `fixtures/xero/charts/`, tested in `tests/mapping.test.ts`. They are synthetic, not recorded, because recording real charts needs live connections.
- **B:**
  - The monthly BalanceSheet (`periods=11`, `timeframe=MONTH`) replaces the closing balance sheet, and the opening one when the prior year end is inside the 12 months. The monthly P&L is one extra call.
  - Sources without monthly reports (older fixtures, labelled sets) fall back to single-date calls.
  - **Deviation:** one statement row per month (`kind` `bs_monthly` / `pl_monthly` / `cf_monthly`, month in `period_to`) instead of `period_index`/`period_end` columns on `statement_lines`. It's the same data, and the line primary key is unchanged.
  - Monthly cash flow covers only months in the current financial year (the year-end roll isn't a monthly movement). The one `cashflow_unreconciled` item for months opens only when the year to date reconciles.
  - Trends live in `lib/signals/trends.ts` with flags `trend:<key>` (statement kind `trend`). Thresholds are in `rules.yaml → trends:` and are PROPOSED starting points (debtor 45 days, creditor 60, stock 60, headroom 6 months; min change 7 days or 1 month).
  - Headroom's £ value is the cash needed to get back to the threshold.
  - The line page shows the 12-month series.
  - `GET /api/orgs/:org/statements/:kind?months=12`.
  - Sample monthly fixtures come from `scripts/make-monthly-fixtures.py`, derived from the YTD fixtures.
- **C (PROPOSED rule, CHANGES §4 item 4):**
  - `lib/detect/lifecycle.ts` works at month granularity, since supplier spend is monthly aggregates. "Cycle + 15 days' grace" means a payment counts as missed from the month end after the month it was due. So a monthly app is lapsing for one month, then inactive.
  - Supplier spend now looks back 13 months for annual apps; `spend_12m` stays 12 months.
  - `detected_apps.present` now means the state counts as coverage (new, active, lapsing, declared). It used to mean "paid in 2 of the last 4 months".
  - Apps with one payment or irregular gaps count while recent and are never asked about.
  - Questions appear on the summary page, answered via `POST /api/orgs/:org/apps/:appId/status`: still_use, moved, stopped, replacing, both.
  - `app_lapsing` queue items appear after 30 days unanswered, which in practice only happens for quarterly and annual apps.
