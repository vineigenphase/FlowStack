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
