# HANDOFF: where the build is (8 Nov 2026)

Read this first, after CLAUDE.md, BACKEND.md and NOTES.md. NOTES.md "Rest of the spec, no Stripe" has the detail.

## State

- **Stripe is paused.** The owner is rethinking it, so build no billing until they decide.
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
- **Production** (`main`) is still at c5841a8.
  - Merging `dev` → `main` deploys, and Vercel runs `pnpm db:migrate`, applying migrations 0006–0011 to production. They only add tables, columns and row-level security.
  - The owner runs the merge: `! cd ~/flowstack && git checkout main && git merge dev && git push origin main && git checkout dev`
- **Checks:** `pnpm lint`, `pnpm test` (20 files, 163 tests), `pnpm test:e2e`.

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
