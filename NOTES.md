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
Fix needs a spec decision (see conversation); not changed unilaterally.
