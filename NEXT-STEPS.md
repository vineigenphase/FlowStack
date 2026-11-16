# NEXT-STEPS.md: what to build next (16 Nov 2026)

> For Claude Code, in the FlowStack repo. Saved into the repo 16 Nov 2026 as received (owner). It replaces SPRINT-1.md and
> BUILD.md (never committed; ignore them) and HANDOFF.md's "Could still be built" list. Build log: NOTES.md "NEXT-STEPS build log".
>
> Reading order: CLAUDE.md, BACKEND.md, NOTES.md, HANDOFF.md, UI-SPEC.md, this file. It restates the round-2 decisions
> (10 Nov), so CHANGES-v1.2.md is not needed.

## 1. Where the build is (main = dev = 0dc2556, 13 Nov)

**Built:**
- Xero OAuth (read-only) and refresh
- statements, including 12 months and derived cash flow
- mapping by reporting code, tax rate and synonyms
- detection, lifecycle, flags, trends
- ranking (0.50/0.35/0.10/0.05, Add/Change)
- line page with "Is this right?", four answers and sub-reasons
- stack map, Ask, directory and dossier, reviews, after-install check-ins, settings, switcher, connection cap
- practice area, admin queue
- Stripe in test mode
- the UI-SPEC §8 API with mock mode and nine scenarios
- waitlist API
- Playwright e2e and the eval gate in CI

One live business (Jenki Drinks) completed a full refresh on 10 Nov.

**Known gaps:**
- refresh is slow and blocking: it runs inline, and the apps step is heavy (118 Xero calls, ~19 MB)
- no loading, error or empty screens
- pages are plain and read the database directly; the UI-SPEC screens aren't built
- ranking is weak where it matters most (thin integration graph)
- the eval labels are Claude's drafts, not yet reviewed by a person
- catalogue incomplete: no crawl URLs or Companies House numbers entered
- visitors to the deployed site can only sign in with Xero

## 2. News since 13 Nov (context, not features)

- **Design review:** a senior product designer will send proposed UI specs for the priority flows. **No visual or layout redesigns before his feedback.** Make the current screens work properly instead (states, speed, access).
- **Potential testers:** Luke has joined a finance leaders' council linked with Xero and Mayday. Members may try FlowStack free. They are **potential testers, not customers or partners.** Plan for at most 5 Xero connections (Starter plan).
- **Sales help:** Luke's wife is helping with outreach until February. She needs a public landing page, a waitlist and a sample to show.
- **Legal:** a lawyer friend will give a steer on peer prices. Peer prices stay off (`PEER_PRICES_ENABLED=false`) until it's in writing.
- **Prices:** still OPEN. No real prices in code; test mode only.

## 3. Round-2 decisions to apply (10 Nov)

| # | Decision | Change |
|---|---|---|
| a | Lapsing apps: **7 days' leeway**, and only once the books have caught up | 3a |
| b | `miscoded` is not our false positive (data quality); `one_off` hides the line for the current period only | 3b |
| c | One-off detection from the monthly P&L | 3c |
| d | Monthly digest to each business, 7 days before billing (1.0) | Compose and preview now; send once a provider is chosen (P2) |
| e | Plans: monthly + one-off audit · annual **with audit included** · audit only · coupons `audit_waived`, `design_partner` | Reshape plans.yaml + checkout; prices stay null |
| f | Activators: threshold **5**; counting contributions is proposed, still OPEN | `contributions` table only; no reward logic |
| g | Peer prices off, pending legal | No change |

### 3a. Lapsing rule
- During aggregation (before rows are discarded), record per org:
  - `books_through` = the latest date of any bill or spend bank transaction seen
  - per detected app, `last_paid_date` (a day)
- Expected date = `last_paid_date` + billing cycle.
- Missed only when **both** today ≥ expected + 7 days **and** `books_through` ≥ expected + 7 days.
- `lifecycle.leeway_days: 7` in rules.yaml.
- Lapsing → ask the user. No answer → still counts as cover until a second payment is missed under the same rule → inactive.
- Tests:
  1. books entered only to 3 weeks ago → no lapse
  2. 6 days late → active
  3. 8 days late with later bills → lapsing
  4. second miss with no answer → inactive
- Remove the TODO pointing at CHANGES-v1.1 §4 item 4.

### 3b. Feedback metrics
- FP report gives four figures per rule and per week:
  - **false positive:** `no_app_needed` + `numbers_wrong` (`wrong_category`, `figure_mismatch`, `one_off`)
  - **detection miss:** `already_use_app`
  - **data quality:** `miscoded`
  - **not now:** count only
- The eval gate uses the false-positive rate only.
- `one_off` → line fine for the current period only (an end date on the override).
- `figure_mismatch` → re-fetch that report straight away and compare. Still different → high-priority queue item with both values.

### 3c. One-off detection
At least 3 months of data and one month ≥ 60% of the year-to-date value (`rules.yaml → one_off.concentration: 0.6`):
- drop the band one level
- evidence note "Most of this year's total is in one month (<month>). It may be a one-off."

Tests: a spike and a steady line.

## 4. Next steps, in priority order

### P0: designer and tester ready (this week)
1. **Check production:**
   - migrations through 0018 applied and `pnpm deploy:check` passes
   - one live refresh on the sample/Jenki connection completes
   - report back
   - `.env.local` points at the **production** database; use the Neon preview branch for anything that writes
2. **Read-only demo on the deployed site:**
   - `/demo` → guest session for one sample org, behind `DEMO_ENABLED`
   - guests can't write settings, connect Xero, bill or answer as a real user
   - guest feedback and shortlist kept 24 hours, out of all metrics
   - "Sample data" on every page
   - tests: guests can't read real orgs; their feedback is excluded from the FP report
3. **Background refresh + progress:**
   - start the refresh, return the run id, run the steps in a background job (Inngest, or `waitUntil` first)
   - `/connect/progress?run=` polls `/api/orgs/:org/refresh/:runId`
   - remove the NOTES deviation "refresh runs inline"
4. **Loading, error and empty states:**
   - `loading.tsx` (skeleton) and `error.tsx` (message, Retry, request id) for every `/app/[org]` route and `/apps`
   - plain empty messages
   - design-neutral
5. **Tester access:**
   - `ACCESS_MODE=invite`: connecting real Xero needs an approved waitlist email or an invite code (admin approves)
   - testers get `design_partner`: free, full access, no Stripe
   - "Report a problem": page URL + last request id + note → queue item `user_report`
   - the cap stays at 5
6. **Apply round-2 decisions 3a, 3b, 3c.**

### P1: before testers connect their own Xero
7. Labelled set reviewed by a person: export the drafted labels as a sheet (line, our state, expected state, reason); import corrections; re-run `pnpm eval`. The gate only counts once a person has signed off the labels.
8. Fill the integration graph: sourced edges, ecommerce/SaaS first, a source note per edge, no guesses.
9. Catalogue facts for the top 20 apps:
   - a checklist of crawl URLs (pricing, integrations, security, terms) and Companies House numbers to enter
   - crawl the ones entered
   - missing stays "Not published · we're checking"
10. Load on Xero: the incremental apps step stays under the Starter limits (60/min, 1,000/day per business); log calls and bytes per step on the debug output.
11. Public landing page + waitlist form:
    - what it does, read-only promise, time-is-salary calculator with editable defaults
    - "See a sample" → `/demo`, the existing waitlist API
    - only sourced, linked stats
12. Plans reshape (3e) + billing page: prices from plans.yaml only; null → "Plans coming soon"; `design_partner` → a thank-you state.

### P2: next
13. Monthly digest (3d): compose (template only, no LLM) + admin preview; sending behind `RESEND_API_KEY` once a provider is chosen.
14. `contributions` table (3f) and an `app_state_history` table.
15. **UI-SPEC screens not yet built** (before-you-connect, set-up, overview headline, line panel, apps in use, every-year, compare, shortlist drawer): wait for the designer's specs. Meanwhile:
    - keep the API, mocks and `tests/mock.test.ts` in sync
    - fix decided "UI-SPEC vs backend" deviations: for the in-use app, add `inUse: true`, keep `kind: null`, and update UI-SPEC to match

## 5. Parked: do not build
- peer price display
- the firms' Monday digest
- "drop" recommendations
- vendor portal
- Finance API
- tracking categories and market auto-detection (2.0)
- QuickBooks
- written Ask answers in production

## 6. Waiting on the founders
1. Prices, and what a free user sees before paying.
2. Email provider.
3. Legal steer on peer prices.
4. Activators: contributions model and the threshold of 5.
5. Whether `miscoded` stays out of the FP rate (proposed: yes).
6. Sign-off on the eval labels (Luke).
7. Default wording for the opt-ins on the terms page.

## 7. Before every merge to main
- `pnpm lint`
- `pnpm test` in two batches with `--maxWorkers=2`
- `pnpm eval`
- `pnpm test:e2e` (incl. 400px)
- Read every generated migration. Python writes files with `encoding='utf-8'`.
- Merging to main deploys and runs migrations. **The owner runs the merge.**
