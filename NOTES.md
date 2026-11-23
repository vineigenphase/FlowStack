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
- **L (PROPOSED):**
  - Crawl page kinds now include integrations, security and terms (`apps.yaml → crawl:`). **No URLs have been added yet:** the spec says a person finds them, never guesses.
  - `lib/vendors/companies-house.ts` stores `vendor_incorporated` and `vendor_ownership_changes` as verified, with the register page as the source. These facts appear in a "Vendor" group on the dossier and are refreshed by the monthly cron.
  - Each app needs `companies_house: <number>` in apps.yaml, entered by hand (none yet), plus `COMPANIES_HOUSE_API_KEY`.
- **P:**
  - Added Shopify, Amazon (selling), PayPal, ChartMogul, Baremetrics and Easy Month End (new app category `month_end`). All are sample: true, with sites probed by FlowStackBot and a Xero edge only where the vendor page mentions Xero. PayPal's site didn't answer the crawler, so its facts need a person. The other apps on the cofounder list were already in the catalogue.
  - `scripts/make-synthetic.ts` is now one generator with three company specs. Copperpot's output is byte-identical; new are `demo-uk-ecommerce` (Northwind Goods, stock days rising) and `demo-uk-saas` (Lumen Analytics, debtor days rising). Both reconcile.
  - `pnpm db:seed --samples` creates all three.
  - Industry keys `ecommerce` / `saas`.
- **O:** `reward_ledger` table only.

## UI-SPEC vs backend (13 Nov 2026)

UI-SPEC.md (front-end spec v1.0, owner) saved as received. Where it differs from what the backend serves today:

**Built 13 Nov 2026 (dev):** `lib/api/types.ts`, `lib/api/contract.ts` (read models), `lib/api/server.ts`, `lib/api/client.ts`, mock mode (`mocks/` generated by `pnpm mocks` from the sample companies; `/api/mock/*`; all nine `?scenario=`s), ApiError on every error (+ `x-request-id`), every §8 endpoint, feedback sub-reasons + undo, waitlist (migration 0018).

Deviations from UI-SPEC v1.0 (tell the front-end developer):
- ~~`Recommendation.kind` is `null` for the app already in use (the spec allows only add/change).~~ Decided (NEXT-STEPS P2.15): keep `kind: null` with `inUse: true`; UI-SPEC updated to match (16 Nov).
- `benchmarkOptIn` is the existing price-sharing consent (`orgs.share_prices`); nothing shows peer prices (OPEN).
- ~~`digestOptIn` is accepted and always reads false until the owner specifies the email.~~ Stored since P2.13 (16 Nov, migration 0023).
- Plans: `annual` doesn't include the audit and `audit_only` is unavailable until decided; all prices null.
- `industry` is ecommerce | saas | other; a stored finer industry (hospitality…) reads as other and isn't overwritten by "other".
- Answer route for "Is X replacing Y?": `:appId` is the old app; send `replacementAppId` (the new one).
- `GET /apps/:id?org=` marks integrations with the business's apps (`usedByOrg`).
- Mocks are regenerated with `pnpm mocks`; tests/mock.test.ts fails when they fall behind the contract.

**Needs an owner decision before building:**
1. Plans: the spec has monthly / annual (audit included) / audit only; catalog/plans.yaml has pro_monthly / pro_annual + a one-off audit add-on with a waiver coupon. Prices are still OPEN (CHANGES-v1.1 §4 item 1).
2. The peer-benchmark opt-in on /connect asks consent for peer prices, which are OPEN pending lawyer + Xero partner sign-off (§4 item 2). Storing the tick is harmless; the wording promises a feature we may not ship.
3. "Monthly email a week before billing" (digestOptIn) is new: not in BACKEND.md. The parked Monday digest is the firm one.

## Live ledger review (13 Nov 2026, Jenki Drinks)

- 94 of 205 lines were "queued": types were applied too strictly (stock/prepayments on CURRENT, depreciation on OVERHEADS, all equity). Fixed with type_only lists, a control/clearing category, EQUITY → other_equity default and synonyms from real names: accounts needing a person 181 → 45 (checked read-only against the live chart).
- The integration graph had only Xero edges, so 35% of every score was identical and ties fell to the alphabet. Tie-break now prefers apps that handle the line; 5 sourced Shopify/Square edges added. **The graph still needs filling** — the biggest remaining ranking weakness.
- 12 payroll-related lines (P&L + balance sheet + cash flow) flag the same gap. One "We already use an app" answer declares the app and covers the rest on the next refresh.
- No trend flags for Jenki; thresholds unchanged (owner to tune).
- Apps step now incremental (rebuild from the earliest changed month; weekly full rebuild).

## NEXT-STEPS build log (16 Nov 2026, autonomous overnight run)

NEXT-STEPS.md (owner, 16 Nov) replaces SPRINT-1.md / BUILD.md (never committed; the half-built `pnpm doctor` from SPRINT-1 was discarded) and GAP-REPORT.md's fix order. Merges to main stay with the owner.

**P0.1 production check (16 Nov):** migrations 0000–0018 applied on production (19 rows; waitlist table and flag_feedback.sub_reason present); `/api/health` ok, xero_mode live, nothing missing; deploy:check DB part ok (flowstack_app exists, RLS on 38 tables, SET ROLE works). Not done: deploy:check with production settings (pulling Vercel env was refused by the permission system) and the live Jenki refresh (needs the deployed app's Xero keys; owner presses "Refresh from Xero"). Last Jenki run: 10 Nov, ok, 124 calls.

**P0.2 demo (decisions):**
- Demo business = the ecommerce sample (fixtures `demo-uk-ecommerce`) at a fixed id `…d3e0`, created on the first /demo visit by the real pipeline (no Xero). `DEMO_ORG_ID` may point at another org but must be `sample`.
- Guest = 24-hour iron-session fields (`guestId`, `guestOrgId`, `guestUntil`) — no user row. `requireOrgReader` (pages + GET routes) accepts members or that guest; every write still uses `requireOrgMember`, which a guest can't pass.
- Guest feedback and shortlist go to `guest_actions` (migration 0019, owner-only, RLS on, purged nightly after 24 h). The shared sample business never changes; the guest sees their own answer on the line page. Nothing reaches flag_feedback, shortlist, the FP report or eval.
- Settings and Ask show "isn't part of the demo"; quote requests are hidden for guests. Every page of a sample org shows a "Sample data" banner.

**P0.3 background refresh (decisions):**
- `startRefresh` creates the run (steps pending) and returns; `executeRefresh` does the steps. The API and the Xero callback start runs, return at once and run the steps with Next `after()` (kept alive on Vercel up to the 300 s maxDuration). Inngest stays a later step (no account/keys yet). `runRefresh` = both, for cron, eval and the demo business.
- The callback now sends a first-time connect to `/connect/progress?run=` (polls every 2 s; "still working" after 60 s; done → overview, partial → note + link, error → Try again + reference). There is no `/setup` page yet (UI-SPEC screens wait for the designer), so done goes straight to the overview.
- A run whose Xero client can't be built (revoked, token refused) is now marked error at once instead of hanging as "running" until the 5-minute abandon rule.
- Removed deviation "POST /orgs/:org/refresh runs inline".

**P0.4 states (decisions):** `loading.tsx` (plain skeleton) and `error.tsx` (message, Retry, Next's error digest as the reference — the same id our server logs carry for a page render error) on every `/app/[org]` route and `/apps`, from one shared `components/states.tsx`, so the designer replaces one file. Empty messages: "No reviews yet.", "No apps found for this filter." (overview and apps-in-ledger already had theirs). `tests/route-states.test.ts` keeps every route covered. Also fixed: trend lines showed their key ("trend:stock_days") on the overview and line page.
Smoke-tested /demo on a dev server against a throwaway PGlite (not the production DB): the demo org builds, the overview renders with the banner, guest writes to settings/refresh are 401, another org 404, guest feedback and shortlist answer from guest_actions.

**P0.5 tester access (decisions):**
- `ACCESS_MODE` = `open` (default, as before) | `invite`. The gate runs inside the connect transaction, after Xero tells us the email: existing users and ADMIN_EMAILS always pass; otherwise an admin-approved waitlist email or an invite code (typed on `/connect`, carried in the OAuth cookie). A refusal writes no rows, and the connection is deleted at Xero and the token revoked, so a refused person doesn't use one of the 5 Starter slots. They land on `/connect?error=invite_only`.
- Testers (approved or invited) get `orgs.design_partner = true` on the businesses they add (migration 0020): `subscriptionOf` → `design_partner`, and settings shows a thank-you instead of billing. No Stripe objects.
- `/admin/testers`: the waitlist with Approve buttons, invite codes (1–5 uses, optional expiry, readable `FS-XXXX-XXXX`), and the connection count against the cap. Codes and approvals are audited.
- "Report a problem" in every org page's footer: page path (host dropped) + the last error reference (left in sessionStorage by the error screens and the progress page) + a note → queue item `user_report` (actions note / dismiss). Signed-in users and demo guests only.
- Added a plain `/connect` page (UI-SPEC §5.2 content, design-neutral): what we read and never do, invite code field in invite mode, Xero error messages. The benchmark opt-in tick box is left out while peer prices are OPEN.
- The cap stays at 5 (XERO_CONNECTION_CAP).

**P0.6 / 3a lapsing rule (DECIDED 10 Nov):** aggregation keeps each supplier-month's latest date (`supplier_spend.last_date`); detection sets `orgs.books_through` (latest bill or spend date of any supplier) and `detected_apps.last_paid_date`. Expected = last paid date + cycle (month-end clamped); missed only when today AND books_through are ≥ expected + `lifecycle.leeway_days` (7, rules.yaml). One miss → lapsing (asked, still cover); a second unanswered miss → inactive. Rows from before migration 0021 (no dates) use the month rule, now with 7 days too, until the next refresh rebuilds them (a full rebuild happens weekly). The CHANGES-v1.1 §4 item 4 TODO is removed. `DetectedApp.lastPaid` in the API is now the day.

**P0.6 / 3b feedback metrics (decisions):**
- The FP report (`/api/admin/fp-report`) now has four figures overall, per rule@version and per ISO week: false-positive rate (no_app_needed + numbers_wrong with wrong_category / figure_mismatch / one_off, or with no sub-reason recorded), detection-miss rate (already_use_app), data-quality rate (miscoded), not-now count. Denominator = yes + no_app_needed + numbers_wrong + already_use_app. The eval gate is unchanged (labelled set, FP only). Whether miscoded stays out of the FP rate is still marked PROPOSED (NEXT-STEPS §6.5).
- one_off → `marked_fine` override with `until` = the end of the financial year the figures belong to (no review item; the business told us what it is). Overrides with an end date now expire for every state, not just snoozes.
- figure_mismatch → re-fetch that report from Xero at once (P&L or balance sheet; one read-only call) and rebuild the line the same way. Xero now differs from ours (or the line has gone) → a **high-priority** `flag_disputed` item with both figures and a message to press Refresh; the same → a normal item ("check the period or account with the business"); Xero unreachable → a normal item saying so. Cash flow and trend lines aren't re-fetched (derived).
- review_queue has a `priority` column (migration 0022): high first in the admin queue, marked "High priority". A high-priority report updates an item that's already open.

**P0.6 / 3c one-off detection:** `lib/signals/one-off.ts` (pure). With ≥ 3 months of this financial year's monthly P&L (`rules.yaml one_off.min_months`), a P&L line whose largest month (in the direction of the year-to-date total) holds ≥ 60% of it (`one_off.concentration`) drops one band (high → medium → low) and its evidence carries `one_off: {month, share, note}` — "Most of this year's total is in one month (Jun 2026). It may be a one-off." The API's `Line.oneOffNote` shows it (the user's own "one-off" answer wins); the line page shows the note. Materiality and the £ figure are unchanged. None of the sample companies has one (their fixtures are steady), so the mocks show none.

**P1.7 labelled set review:** `pnpm eval:export [file]` → one CSV row per line (org, line key, line name, our state, expected state, reason, reviewer_state, reviewer_note); the current sheet is `docs/labelled-review.csv` (155 lines, sample fixtures only). Luke fills `reviewer_state` ("ok", or the right state) and a note, then `pnpm eval:import <file> --by "Luke"` writes the corrections into `fixtures/labelled/*.json` and adds `signed_off {by, at}` (a sheet with a bad state writes nothing). Until every labelled org is signed off, `pnpm eval` prints the gate as **provisional** and exits 0 (so CI can't block or falsely pass on drafted labels); after sign-off it gates at FP_GATE as before.

**P1.8 integration graph (16 Nov batch):** + Chargebee–GoCardless, Syft–Shopify, Syft–Stripe, Cin7–Amazon, Brightpearl–Amazon, Airwallex–Shopify (native, each with its vendor source URL in apps.yaml). Not added (no first-party source found): Chaser–GoCardless, Link My Books–Square, Deputy–BrightPay, Katana–Amazon (vendor page with no stable URL). Graph now: 32 non-Xero edges, 22 with a per-edge source (the other 10 were hand-entered earlier with an app-level source note). Still thin for spend/payables, data capture and payroll — next candidates: Dext/AutoEntry/Hubdoc ↔ ApprovalMax, Pleo/Spendesk/Soldo ↔ the apps they export to, Employment Hero/Staffology ↔ rota apps.

**P1.9 catalogue facts:** `pnpm catalogue:checklist` writes `docs/catalogue-checklist.md`: for the top 20 ecommerce/SaaS apps (selling channels, SaaS billing + metrics, stock, bill capture, spend, cash forecasting), which crawl pages (home, pricing, product, integrations, security, terms) and Companies House numbers still need entering — 114 entries today. These are found by a person on the vendor's own site (v1.1 L: never guessed), so none were filled in and no crawl was run (nothing new to fetch; the crawl writes the production DB). Once entered: `pnpm crawl`.

**P1.10 load on Xero:** the paged lists (bills, spend transactions) now ask for 1,000 rows a page (`pageSize`, accepted on /Invoices and /BankTransactions per XeroAPI/Xero-OpenAPI `xero_accounting.yaml`; the 1,000 maximum is from Xero's docs, not the spec — a page is treated as the last only when it has fewer than 100 rows, so a lower cap by Xero can't silently drop records; watch the first live run's per-step calls). Load test (`tests/apps-incremental.test.ts`): ~11,000 bills + spends over 13 months = ≤ 14 calls for a full rebuild, ≤ 6 for a daily refresh; 24 full refreshes a day would still be under 1,000/day. Fixed: a 429 for the daily limit (`X-Rate-Limit-Problem: day`, or any Retry-After over 60 s) used to sleep for the Retry-After (hours) inside the request; it now throws `XeroLimitError` ("Xero's daily call limit for this business is used up. Try again tomorrow."). The apps step is skipped (run "partial", last detected apps kept) when `X-DayLimit-Remaining` < 100 (`APPS_DAY_RESERVE`). Each step's calls and bytes (and the day/minute calls left) go to `log.debug` "xero step" (counts only; LOG_LEVEL=debug) as well as `sync_runs.steps`. The 60/min and 5-concurrent per-business limiter was already in place.

**P1.11 landing page:** signed-out `/` is now the public landing (UI-SPEC §5.1) in the existing plain styles (no redesign before the designer): hero ("Join the waitlist", "See a sample" → `/demo` only when DEMO_ENABLED), read-only promise (same list as `/connect`), "Time is salary" calculator (defaults £55,000 and 10 hours, both editable; salary ÷ 1,800 × hours, formula shown), how it works in 3 steps, sourced stats, waitlist form → existing `POST /api/waitlist` (repeat email gets the same success message), "Already invited? Connect Xero" → `/connect`. Signed-in users still get their businesses list. Stats live in `STATS` in `components/landing.tsx`, each with a first-party link and a checked date; only one passed: "More than 1,000 apps are certified in the Xero App Store" (Xero media release, Aug 2026, checked 16 Nov). The UI-SPEC example ("1,000+ (May 2021) to 1,100+ (March 2024)") was left out — no first-party page found for the 2021/2024 figures. A test fails if the landing prose gains a £/%/thousands figure outside STATS. Checked at 400 px in light and dark on a dev server with a throwaway PGlite.
Also fixed (found while testing): the route error log kept the stack minus its first line, but a drizzle "Failed query" stack carries a `params:` line further down (it logged a waitlist email). `safeStack` now keeps only `at …` frames.

**P1.12 plans reshape (3e) + billing page:** plans.yaml now has monthly (`audit: extra`: the one-off audit line is always added at checkout, waivable with the `audit_waived` coupon — limit that coupon to the audit product in Stripe), annual (`audit: included`: no audit line), and the audit sold alone (`sold_alone: true` → "audit only", a one-off `payment` Checkout, no subscription). Coupons: `audit_waived`, `design_partner` (listed for a later move to paid; checkout never applies it, and design partners get a 409 from checkout — they have no Stripe objects). Prices all stay null. New `/app/[org]/billing` (UI-SPEC §5.15, plain): design partner → "You're a design partner: free until launch. Thank you."; active/past due → status, renewal date, Manage billing; no plan has a price → "Plans coming soon" (no buttons); a plan without a price can't be chosen; `?billing=done` → "You're all set", `?billing=cancelled` → "No charge made". Stripe now returns people to the billing page, not settings; settings links to it. Not done: an audit-only purchase is logged in payments_log by the webhook but not recorded anywhere the app reads (no audit flow exists yet).

**P2.13 monthly digest (3d):** `orgs.digest_opt_in` (migration 0023, default off; settings checkbox "Monthly email", audited `digest.on/off`; the contract `digestOptIn` now reads and writes it). `lib/digest` composes one email per business from the summary read model — lede (£ at stake, flagged lines, period), "Needs you" (connection/refresh/payment banners), the 3 biggest flagged lines, flagged trends, app questions (lapsing/replacement), Open FlowStack, and an off link — as HTML (inline styles, escaped) and plain text. Template only, no LLM, no transactions. Send date = billing date (subscription current period end) − 7 days; no paid subscription (design partners, no plan) → no send date. `/admin/digest/[org]` previews it (sandboxed iframe + text) with opt-in and send date. **Nothing is sent**: no provider chosen; `RESEND_API_KEY` is only noted in .env.example. When one is chosen: a nightly cron sends to opted-in businesses whose send date is today (to whom: members of the org — decide whether all members or only the person who connected).

**P2.14 tables (migration 0024):** `app_state_history` (tenant table, RLS + flowstack_app SELECT/INSERT): detection records each app whose lifecycle state differs from the last run (appeared: from null; gone: to null), since detected_apps is rewritten every run. Pure `stateChanges` in lib/detect. `contributions` (owner-only, RLS on, no app-role grant): user id, org (set null if the business is deleted), kind (review / app_answer / flag_feedback / missing_app / integration_edge / fact_correction), ref id, status pending/approved/rejected. Nothing writes contributions or grants rewards: the model and the threshold of 5 are still with the founders (NEXT-STEPS §6.4).

## Engine v2 build log (22 Nov 2026, branch `engine-v2` off dev 09b5f32, not merged)

ENGINE-V2.md (owner, 22 Nov) saved in the repo as received. It wins over the other specs on its items.

### Phase 0: app database (done; stopped for the owner's review of `docs/appdb-import-report.md`)
- **What the database is:** the owner's catalogue handoff (17 Nov workbook) plus the 723 public Xero listing pages read on
  18 Nov. ENGINE-V2 §0.1 says "it isn't in the repo yet" because that work sat on the unpushed `catalogue-engine` branch.
  The handoff zip re-sent on 22 Nov is byte-identical. Commit 3d43d4b (data only: handoff, `build-directory.ts`, the
  directory) was cherry-picked onto `engine-v2`, then moved to `data/xero-apps/` (handoff → `handoff/`,
  `catalog/directory.json` → `data/xero-apps/directory.json`) with `SOURCE.md`. Listing raw pages stay local and gitignored.
  The rest of `catalogue-engine` (chain, xero-links, its engine) was **not** brought over: Phase 1 builds v2 as specified.
  Its useful parts (chain, Bayesian rating, price comparability rules) can be reused there.
- **Adapter:** `pnpm appdb:adapt` (`scripts/appdb/adapt.ts`, `lib/appdb/{schema,adapt}.ts`) → `data/xero-apps/listings.json`
  (canonical shape, Zod) + `docs/appdb-import-report.md`. Idempotent, `--dry-run`, no DB writes. Result: 728 read, 728
  accepted, 0 rejected. Left out with reasons, never filled: 44 tiers with no billing period (mostly quote/custom
  plans), 6 trial tiers, 2 per-transaction tiers, 6 vendor award claims.
- **Choices (deviations to confirm):**
  - `price_gbp` only when the vendor states £. USD/AUD/EUR and currency-unknown tiers keep `price_gbp: null`, never converted.
  - `rating_count` = `review_count` = Xero's one count. 0 reviews → `rating_avg: null`.
  - Awards: official Xero records only (15, all "Xero Global App Awards 2025, winner"). The source doesn't say which
    regional category, so `region: "unknown"`. Under §1.2 ("business's region or global") they would count for no one
    until the owner says how to treat them.
  - `xero_categories` = the listing's App Store categories. `xero_functions` = the listing's data-flow objects (28 names,
    Xero's own spelling, `catalog/xero-functions.yaml`). ENGINE-V2's examples "Payroll"/"Inventory" aren't Xero object names.
  - `catalog/xero-category-map.yaml` (PROPOSED) starts from the reviewed 18 Nov function links. It widens "Bills and
    expenses", "Payments" and "Reporting and forecasting", since v2 has no jobs-to-be-done step.
  - Matching: the reviewed crosswalk (`catalog/directory-crosswalk.yaml`) goes before website/name/fuzzy. A domain
    shared by two listings, or one app claimed twice, is unsure. 69 matched, 6 unsure (Cin7 ×2, Modulr ×2, ApprovalMGR,
    Solido). `appdb_match` queue items are created in Phase 1 with the table load (review_queue.kind is free text,
    so no enum change is needed).
- **Biggest finding:** §0.3 makes only `catalog/apps.yaml` apps candidates ("don't auto-create"). That leaves 653 of
  728 listings out of v2 until a person adds them. Example: UK payroll has 25 listings, 5 catalogue apps; compliance
  has 20 listings, 1 catalogue app. Owner to decide (below).

### Waiting on owner (Engine v2)
1. **Terms check:** OK to use App Store descriptions, ratings and review counts under Xero's App Store terms? Until then,
   descriptions are used only for keyword matching and the admin panel; ratings are shown only as numbers attributed
   "Xero App Store, captured <date>"; no review text (none was collected).
2. **Candidates:** keep v2 to apps.yaml (and add apps by hand with `sample: true`), or let matched-or-not listings be
   candidates directly? Note that `sample: true` on real vendors would put a "sample" label on real data.
3. The 6 unsure matches (report §2).
4. Awards with region "unknown": count them as global, or not at all?
5. The PROPOSED category map, and the sub-weights inside `fit` and `quality` plus the award boost (Phase 1).
6. Prices: 90 of 728 listings have a £ tier, 62 have a per-org £ tier. Price will mostly score "missing" (0.5).

### Owner decisions, 23 Nov 2026 (on the Phase 0 report)
1. **Every listing is a v2 candidate** (not only apps.yaml). Where a listing matches a catalogue app, that entry is used.
2. **Terms:** OK to use App Store descriptions, ratings and review counts.
3. **Awards** whose region isn't stated count as **global**.
4. **Prices in £:** every price is converted to pounds (the UK is the main market). ECB reference rates in
   `catalog/fx-rates.yaml` (20 Nov 2026). Each converted tier keeps `original` {amount, currency, fx_date}. 58 tiers
   converted (USD 41, AUD 14, NZD 1, EUR 2). The 2 Fergus tiers say only "$", so they stay unpriced (currency can't be known).
5. `rating_count` = `review_count` (Xero's one count): OK.
- The 6 unsure matches and the v2 weights (`rules.yaml → scoring_v2`, sub-weights PROPOSED) are shown to admins at
  **`/admin/engine-v2`** (not linked from the header). The owner reviews them there.

### Incident, 23 Nov 2026 ~00:25 UTC: migrations 0023 + 0024 applied to PRODUCTION without approval
- Cause: a local smoke test ran `DATABASE_URL=pglite:<tmp> tsx scripts/migrate.ts`. migrate.ts preferred
  `DATABASE_URL_UNPOOLED`, which `.env.local` sets to the production Neon URL, so it migrated production instead of the
  throwaway db. Prod's migrations table now has 25 rows (0000–0024). It had been at 0022 since the 16 Nov merge.
- Effect: additive only. `orgs.digest_opt_in boolean default false`, new tables `contributions` and
  `app_state_history` (RLS on, grants to flowstack_app). Production code doesn't read them. `/api/health` ok and home page
  200 right after. The next main deploy runs `db:migrate` and finds them already applied.
- Fix: migrate.ts now uses a pglite:/memory:// DATABASE_URL over any unpooled/admin URL, and prints which database
  it is migrating. Smoke tests also blank `DATABASE_URL_UNPOOLED` and `DATABASE_ADMIN_URL`. The dev server that
  followed wrote only to the throwaway db (checked: the dev-login user is in the PGlite dir).
- **23 Nov, later: match answers + weights.** Owner: Cin7 Core and Cin7 Omni are both `cin7`; Modulr and Modulr AP
  ("Nook" on Xero) are both `modulr`; ApprovalMGR ≠ ApprovalMax, Solido ≠ Soldo. `catalog/directory-crosswalk.yaml`
  now allows a list of listings per catalogue app and has a `different:` section (never asked again). Result: 73 matched,
  0 unsure, 655 directory-only (all candidates). **Sub-weights in `scoring_v2` APPROVED** (the award boost too). The
  Xero → FlowStack category map is still PROPOSED.

### Phase 1: engine v2 in shadow (23 Nov 2026)
- **Built:** `lib/rank/v2/` has one pure file per input (integration-fit, category-match, function-match,
  keyword-match (BM25), rating (Bayesian), volume, awards, price), plus `score.ts` (match, parts, formula, tie-break),
  `trace.ts` (EngineTrace, v1/v2 traces, what-if overrides), `run.ts` (shadow ranking of v1's flags), `apps.ts`
  (pool) and `dev.ts` (trace API + gate). `catalog/rules.yaml`: `scoring_v2` and per-rule `required_functions` /
  `helpful_functions` / `keywords` (ranking only; rule versions not bumped because flagging is unchanged).
- **Shadow mode:** `lib/signals/run.ts` ranks every flagged and covered line with v2 after v1 and writes
  `recommendations_v2` (top 10 + the app in use, parts + warnings in `components`). A v2 error is logged and returned
  in the step result; it never fails the refresh. Customers still see v1 (`ENGINE_VERSION=v1`; only v1 is wired for
  customers until Phase 5). v2 reads v1's flags and never changes them (tests: input unchanged, eval unchanged).
- **Catalogue gaps:** a flagged line with < 3 candidates (not counting the app in use) gets a warning, plus a
  `catalog_gap` queue item per (rule, categories, markets), written after the tenant transaction. Today only
  month_end is thin (`pnpm engine:coverage`).
- **API:** `GET /api/dev/engine/:org/:lineKey?engine=v1|v2&weights=<json>`, 404 unless `DEV_TOOLS=true` and the user is
  an admin (DB check). v2 is recomputed on request; v1 is read from `recommendations`.
- **Migration 0025** (read before committing): `recommendations_v2` (RLS tenant isolation, app-role CRUD) and
  `xero_app_listings` (global, SELECT for the app role). Additive only. `pnpm appdb:load` fills the table and refuses
  a non-local database without `--remote-confirmed`. The engine reads the versioned file, so no prod load is needed.
  0025 reaches production when the owner next merges to main (Vercel runs db:migrate).
- **Pool:** 739 apps (84 catalogue + 655 directory-only). A catalogue app keeps its own categories, markets and
  edges, with its listing attached (Cin7: the listing with most reviews; functions are the union).
- **Choices / deviations:**
  - **Integration fit for directory apps = "none" (0.3), not missing (0.5).** Catalogue "none" means "no known edge",
    not "checked and absent". Scoring unchecked apps 0.5 put every one of them 4.2 points ahead of catalogue apps.
    Chaser was #53 of 235 for receivables on the sample business; it's #3 after the change.
  - Unknown markets (14 apps, no listing read) are kept and flagged in the warnings, not excluded.
  - Price: the cheapest paid tier that can be costed (per business; per user only with headcount, which orgs don't
    have yet), else a free plan. Usage-priced and quote-only tiers → missing.
  - Rating mean C = mean of the rated candidates for the line. Review volume: 0 reviews is a known 0, not missing.
- **Open (owner):**
  1. v2 has **no industry input**. A car-dealer app (MotorDesk) and an equipment-rental app (HireHop) reach the top 5 for
     a hospitality business's stock line. CLAUDE.md §7.3 has industry exclusions; listings carry Xero's industries
     (dropped from the canonical schema). Proposal: add `industries` to the listing and either exclude on a clear
     mismatch or add an industry_fit part.
  2. Price "not published" (0.5) vs a cheap published price (1.0) favours small apps with public price lists over
     well-known quote-only ones (Chaser). Small at 5%, but visible.
  3. Small-sample apps (5.0 from 12 reviews) still sit near the top. The prior (20 at the set mean) is working; a
     bigger prior would push them down.

### Industry fit (owner asked 23 Nov 2026)
- `catalog/industry-map.yaml` (PROPOSED) maps our industries to Xero's listing industries. Ecommerce → Retail;
  hospitality → Hospitality, Tourism. SaaS, wholesale and other → none on Xero, so industry fit is missing (neutral).
  "Professional services" and "Accounting" are general (weak fit 0.3, `industry_fit.broad_only`).
- `lib/rank/v2/industry-fit.ts`: 1 if the listing names the business's industry; 0.3 if only general ones; missing if
  the industry isn't set, Xero has none, or the listing names none. **Excluded** (with the reason in the trace) when
  the listing names only other industries, e.g. MotorDesk ("Built for Automotive, not Hospitality/Tourism"). The
  app in use is never excluded.
- Weights: job_fit was 0.40 / 0.35 / 0.25 (approved), now category 0.35, functions 0.30, keywords 0.20,
  industry 0.15 (**PROPOSED**; `scoring_v2.status.proposed` lists the keys and /admin/engine-v2 tags them). Industry
  is 2.1% of the match: the exclusion does most of the work.
- Canonical listing gains `industries` (Xero labels). Sample hospitality business: MotorDesk gone; Fresho (stock) and
  CostTracker (supplier bills) now in the top 5. HireHop stays, because its listing names Hospitality.
- Xero industries no business of ours maps to yet: Agriculture, Automotive, Education, Property and realty. Apps that
  list only those are excluded for every business (a test pins the list).

### Phase 2: dev tools (23 Nov 2026)
- **Gate:** `lib/dev/tools.ts devToolsOn()` checks `DEV_TOOLS=true` AND `users.is_admin` in the database on every
  render. `components/dev/dev-mount.tsx` renders nothing otherwise, so no markup and no data reach customers,
  testers, /demo guests or the public. Every dev route (`/api/dev/*`, `/api/admin/queue/summary`) checks again and
  answers 404.
- **Rail** (`components/dev/dev-tools.tsx`, every `/app/[org]` page and the admin pages): Engine, Review (count +
  hover list of the 5 oldest, linking to `/admin/queue?item=…#item-…`), Reports, Testers, Debug (new
  `/admin/debug/[org]`: last 5 refreshes, per-step calls/bytes/errors, v2 row count), Checks (disabled until
  Phase 4), Weights. The queue summary is polled every 30 s while the tab is visible.
- **Review box pulse:** 1.6 s glow, amber for normal and red when anything is high priority; the count is always shown.
  Under `prefers-reduced-motion` it's a steady filled badge.
- **Engine panel:** frosted glass, docked right, 440 px, resizable 360–720, minimises to a pill ("Engine · v2 ·
  N flags"). Ctrl/⌘+Shift+E toggles it and Esc minimises. Open state, width and tab are kept in localStorage
  (try/catch; falls back to minimised). `role="complementary"`; focus moves in on open and back to the rail button on
  minimise. Tabs: Ranking (stacked bars, excluded under a fold, warnings), Breakdown (formula, parts table with
  sources, missing highlighted, waterfall), v1 vs v2 (rank moves + main reason), What-if (all 12 weights,
  re-ranks in the browser, Reset, Copy as YAML, "Experiment: not saved"), Data (record, completeness,
  description for admins), Queue (this business). Download trace (JSON).
- **Needs a person:** with dev tools on, the statements and line pages mark queued lines and lines with an open
  flag_disputed / account_mapping item (accounts resolved to line keys on the server).
- **Gotcha:** Next's CSS compiler dropped BOTH `backdrop-filter` and `-webkit-backdrop-filter` when the pair was
  written together. Write only the standard property (prefixes are added). Checked in Chrome: blur applied.
- **Checked locally** (throwaway PGlite, `DEV_TOOLS=true`, Chrome): rail, pulse, panel tabs, minimise/pill, focus
  return, no console errors; the trace and summary APIs give 404 without a session.
- **Owner action:** set `DEV_TOOLS=true` in Vercel (Preview first, Production when wanted). It's off by default, so
  the deployed site shows nothing until then.

### Phase 3: cleaner, corporate look (23 Nov 2026)
- **Tokens only:** `app/tokens.css` is the only file with colour values (`tests/theme.test.ts` fails on any hex or
  rgb() literal elsewhere in app/ or components/). The light tokens are exactly ENGINE-V2's. Dark values are mine
  (proposed) and also pass the test's WCAG AA checks (4.5:1): text, muted, links, buttons, the three status tags and
  text on the glass panel, in both themes. Old token names (`--ink`, `--paper`, `--mark`, `--hand`, …) are aliases,
  so every existing component follows the new palette; the old light grey `--surface` is now `--surface-2`.
- **Shared components restyled:** white header with a shadow and primary-blue selected tab; primary buttons; cards,
  stat tiles, totals, statement tables, notes and directory tiles on `--surface` with border, shadow and 8 px radius;
  24 px grid gaps; max width 1200; tables with 44 px rows and a sticky header; status tags as soft pills ("Look at
  this" warning-soft, "Covered" success-soft, "Fine" neutral, "Checking" warning outline); the £ at stake and `.mark`
  in primary blue (no highlighter).
- **Type:** Inter (variable, next/font) for headings and body with `tnum`/`cv11` on figures; IBM Plex Mono only for
  account codes (`.code`) and IDs. Archivo and Instrument Sans removed. Scale as specified.
- **Theme:** light by default; dark only via Settings → Appearance (`components/theme-toggle.tsx`, saved in
  localStorage `fs-theme`, applied before first paint by an inline script in app/layout.tsx; no cookies, so pages
  aren't made dynamic). No `prefers-color-scheme` anywhere (test). The e2e dark run now sets `fs-theme`.
- CLAUDE.md §1 updated ("Owner restyle 22 Nov 2026; designer may revise"), with the old system kept for reference.
- **Not done:** axe isn't installed (adding it means a new dev dependency), so the contrast checks are computed from
  the tokens in a unit test instead. Page-specific layouts weren't redesigned (designer's job).
