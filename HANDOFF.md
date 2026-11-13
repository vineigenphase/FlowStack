# HANDOFF: where the build is (10 Nov 2026)

Read this first, after CLAUDE.md, BACKEND.md and NOTES.md. NOTES.md "Rest of the spec, no Stripe" has the detail.

## State

- **Spec v1.1 (cofounder review, CHANGES-v1.1.md) is applied** to CLAUDE.md and BACKEND.md (changelog at the top of BACKEND.md), and every DECIDED/PROPOSED item is built on `dev`. NOTES.md "v1.1 build log" has the detail:
  - **A:** finance lead, job title
  - **B:** monthly BS/P&L, monthly cash flow, trend signals
  - **C:** app lifecycle and questions
  - **D:** four feedback answers
  - **E:** Stripe in test mode
  - **F:** Add/Change
  - **G:** peer prices off
  - **H:** digest parked
  - **I:** switcher and connection cap
  - **K:** weights
  - **L:** 7 crawl pages and Companies House
  - **M:** mapping by reporting code and tax rate
  - **O:** reward ledger table
  - **P:** ecommerce/SaaS apps and sample companies
- **Billing:** Stripe is the provider. Prices are OPEN, so only `sk_test_` keys work (`catalog/plans.yaml`, `STRIPE_PRICE_IDS_JSON`).
- **OPEN, not built** (CHANGES-v1.1 §4): prices, peer price sign-off, activator threshold, confirming the lapsing rule, the four answers, and add-vs-change.
- **API contract for the front end (13 Nov, dev):** UI-SPEC.md §8 is served: `lib/api/types.ts`, mock mode (`NEXT_PUBLIC_API_MODE=mock`, `pnpm mocks`, `?scenario=`), every endpoint. Deviations and owner questions: NOTES.md "UI-SPEC vs backend". Migration 0018 (waitlist, feedback sub-reason) not yet on prod.
- **First live connect** (Jenki Drinks, 7 Nov): Xero worked, our statements save failed. Fixed in fb7a443, merged to main (c6d0c1d). **Confirmed 10 Nov 20:56 UTC: the live refresh completed** (all 8 steps). 344 accounts, 0 unmapped, 65 low-confidence mappings and 10 unknown suppliers queued for a person. 38 statements; the YTD cash flow and all 10 monthly cash flows reconcile. 12 detected apps; 5 apps to add, 3 to change. No trend flags. The apps step is heavy (118 Xero calls, ~19 MB, most of the 90 s run). Watch it against rate limits.
- **Tests:** run them in two batches with `--maxWorkers=2`. The full suite in one go has been killed for low memory.
- All of the spec's in-app features are now built on `dev`:
  - Playwright end-to-end tests and the phone-width (400px) check
  - Check-ins after install
  - Peer prices (opt-in, 10+ businesses)
  - Settings
  - Verified reviews
  - Practice plan: clients, flow bar, playbooks, proposals by link, digest, invites
  - Ask (opt-in for written answers)
  - Summary-page measures
  - Ranking priorities
  - Quote requests
  - Admin review queue page at `/admin/queue` (admins only, not linked from the header): reviews to check, quote requests to send, mappings and facts
- **Production** (`main`) is still at c5841a8. dev is at 918c64c.
  - Merging `dev` → `main` deploys, and Vercel runs `pnpm db:migrate`, applying migrations 0006–0017 to production. They only add tables, columns and row-level security.
  - The owner runs the merge: `! cd ~/flowstack && git checkout main && git merge dev && git push origin main && git checkout dev`
- **Checks:** `pnpm lint`, `pnpm test` (28 files, 220 tests), `pnpm test:e2e` (not run since v1.1).

## Owner decisions waiting

1. Stripe, or another way to bill (and so the review incentive, "1 month of Pro").
2. Defaults for the two opt-ins: price sharing and Ask written answers. Both are off now. Wording for the terms page.
3. An email/Slack provider. Needed for the 90-day review follow-up, the Monday digest, colleague magic links and sending quote requests (today a person emails vendors by hand).
4. Legal reading of Xero terms clause 29 (aggregated data) for peer prices. Check CMA guidance on reviews before launch.
5. To turn on written Ask answers in an environment: `LLM_ENABLED=true` and `ANTHROPIC_API_KEY`.
6. Owner-side tasks, not code: Xero App Store listing and certification, moving to the Core plan, a QuickBooks developer app, and the §11 open questions.

## Could still be built (smaller)

- Must-have filters in ranking. Quote requests already collect sites, headcount and must-haves.
- A vendor "claim your listing" flow. Vendor replies are entered by an admin today.
- Tracking categories and market auto-detection (BACKEND 2.0). Both need new Xero calls and recorded fixtures.

## Gotchas

- **Never let Python on this machine write files with the default encoding.** cp1252 corrupted "§" and "≥" and once truncated db/schema.ts, which made drizzle generate a migration dropping every table (deleted before anything ran). Use the Edit/Write tools, or `io.open(..., encoding='utf-8', newline='\n')`. Always read generated migrations before committing.
- **Owner-connection writes (`adminDb()`, e.g. audit_log) must not run inside `withOrg()`.** PGlite has one connection, so it waits on itself and the tests hang.
- `.env.local` points at the **production** database. The Neon preview branch is br-shy-sun-za9iz0jm.
- Stop dev servers by the PID on their port only. Never kill all node.exe.
