# HANDOFF: where the build stopped (7 Nov 2026)

Read this first, after CLAUDE.md, BACKEND.md and NOTES.md.

## What the owner asked

"Continue building, leave Stripe, and address the rest of the spec."

- **Stripe is paused.** The owner is rethinking whether to use it, so build no billing at all until they decide.
- BACKEND.md §18 says "don't build yet" for the post-1.0 items. The owner's request overrides that. Record it in NOTES.md when you write the section for this work.

## Branches and deploys

- Local checkout is on `dev`. `main` → production, and Vercel runs `pnpm db:migrate` on build.
- **Merging to main migrates the production database.** Migrations 0006 and 0007 only add tables and columns.
- `main` is at c5841a8: stack map, 79-app catalogue, /apps pages. The production crawl ran on 6 Nov: 25 apps have facts, 9 have a price.

## Done in this round (committed on dev)

1. **Playwright end-to-end tests.**
   - Run with `pnpm test:e2e`. Config is `playwright.config.ts`, tests are in `e2e/flow.spec.ts`.
   - It uses a throwaway `.pglite-e2e` database and overrides every database variable, so it never touches Neon. It uses the installed Chrome and its own build folder (`NEXT_DIST_DIR=.next-e2e`).
   - It covers connect → diagnosis → recommendations → stack map, plus the 400px light/dark check. That check caught the P&L table overflowing on phones, which is now fixed in globals.css.
2. **Check-ins (CLAUDE.md §7.6).**
   - Code: `lib/checkins/evaluate.ts` (pure logic) and `lib/checkins/index.ts` (database).
   - Tables: `installs` and `checkins` (migration 0006, with row-level security).
   - Day 7: the app's bills are reaching Xero.
   - Day 30: the line now counts as handled.
   - Day 90: the line is still flagged or not, with before/after figures.
   - Renewal −60: what they pay compared with the peer range (needs 10+ businesses).
   - `detectInstalls` turns a recommended app into an install when its first bill is recent. It runs in `recompute()` (`afterInstall` in lib/sync/refresh.ts), which also judges due check-ins.
   - The nightly cron judges due check-ins and refreshes at most 5 stale orgs per night.
   - Detection now stores `evidence.monthly` (monthly totals per app).
3. **Peer prices (§7.3b).**
   - Code: `lib/prices/index.ts`. Table: `price_observations` (migration 0007, row-level security on with no grant, so only the owner connection can read it).
   - Opt-in through `orgs.share_prices`. Sample orgs never count.
   - Only bands of 10 or more businesses are shown. The asking org is left out of its own comparison. Size bands come from annualised revenue.
   - The app page (/apps/[id]) shows a real range when there is one.
4. **Settings page** (`/app/[org]/settings`): industry, markets and price-sharing consent. Consent changes are written to the audit log. Changing markets triggers a recompute.
5. **UI.**
   - Line page: a "We've started using it" button on each recommendation, plus a link to the app page.
   - New "After install" tab (`/app/[org]/after`): monthly bills bars, the check-in cards, a renewal date field and "We stopped using it".
   - New reusable client components: `components/post-button.tsx`, `date-form.tsx`, `settings-form.tsx`.
6. **`lib/db/client.ts`** keeps the database handle on `globalThis`. In the Next dev server, route handlers and pages each loaded their own PGlite copy, so a page couldn't see what a route had just written.

Unit tests: 14 files, 129 pass. Lint and typecheck pass.

## Open problem: the e2e flow test fails

The last run failed at "We've started using it". The click never showed "We'll check it at day 7, 30 and 90", even with retries for 90 seconds. Before the globalThis change, the click worked but the After install page showed nothing.

Next steps:

1. Run `pnpm test:e2e` and read `.e2e-results/*connect*/error-context.md` for the page snapshot.
2. Check whether the POST to `/api/orgs/<org>/installs` returns an error. You can add `page.on("response")` logging in the test.
3. A suspect: on the first visit, the dev server may load the database module before the globalThis handle is set, or PGlite may hit a lock from the double load. Alternatively, run e2e against a production build and allow dev sign-in when an `E2E=1` variable is set. Don't loosen the production guard otherwise.
4. Once it passes, add a NOTES.md section for this round and commit.

## Still to build (rest of the spec, no Stripe)

In suggested order:

1. **Verified reviews (§7.5, DMCC rules).**
   - Proof of use: `detected_apps.months_seen` ≥ 2. Fields: role, four scores, price band, text.
   - Incentivised flag is shown on the review. There's no reward mechanism, because that depends on pricing.
   - Every review goes through the review queue for moderation before publishing, with an audit log entry.
   - Sample orgs' reviews are never public. Order is fixed (newest first), never by score.
   - Vendor replies are entered by an admin. 90-day follow-up shows as an in-app prompt (email needs a provider, which is the owner's call).
   - Feed review scores into `peer_results` in score.ts (neutral until about 5 reviews).
2. **Firm/practice plan (§1 Firm UX).**
   - Tables: `firms`, `firm_members`, `firm_orgs`. `requireOrgMember` must also let firm members in.
   - Practice home: clients ranked by £ at stake. Hours are out of scope by BACKEND D7.
   - 5-segment flow bar from the stack map functions. Filters: fixes ready, proposal out, watching.
   - Playbooks per industry with drift flags.
   - Proposal page: firm-branded, shared by token link, client toggles fixes, "No app pays to appear" footer.
   - Monday digest as a page. Email or Slack delivery needs a provider, which is the owner's call.
   - Invite colleagues with a join link (sign-in stays Xero).
3. **Ask (§7.4)** in `lib/llm`.
   - Keyword + category retrieval from the catalogue.
   - The prompt gets only derived features: industry, size band, detected app names, flagged categories. **No amounts** (BACKEND D9).
   - Answers must cite their sources and refuse to make up prices.
   - Rules-only answer when `LLM_ENABLED` is false. Model: claude-opus-5-5 or claude-haiku-5-5 via @anthropic-ai/sdk (see lib/crawl/extract.ts for the pattern).
   - Re-read the Xero developer terms first (§2.2).
4. **KPIs from BACKEND 2.0**: gross margin, labour %, net income %, on the summary page.
5. **Priority presets (§7.3b)**: Balanced, Lowest cost, Fastest live, Best support, re-weighting each line's ranking.
6. **Quote requests (§7.3b)**: store the situation with no ledger data. A review-queue item asks a person to email the vendors, and replies are entered by an admin. Track response times.

**Owner-side, can't be built:** Xero App Store listing and certification, the Core/Plus plan, QuickBooks (needs an Intuit developer app), the email/Slack provider, the CMA guidance check before reviews launch, the terms page wording for the consent, and the §11 open questions.

## Gotchas

- **Python edits on Windows corrupt files.** Default cp1252 broke "§" and "≥" and once truncated db/schema.ts to 0 bytes, so drizzle generated a migration dropping every table. That migration was deleted before anything ran. Use the Edit/Write tools, or `encoding='utf-8'`. Always check generated migrations before committing.
- Never point local scripts at `.env.local`'s database without meaning to: it's **production**. The Neon preview branch is br-shy-sun-za9iz0jm (endpoint ep-frosty-dew).
- Stop dev servers by the PID on their port only. Never kill all node.exe.
