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
