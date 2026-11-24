# DEPLOY.md — Vercel + Neon (M9)

Everything in the repo is deploy-ready: `vercel.json` (migrations on build, crons), Sentry (`instrumentation.ts`,
active only when `SENTRY_DSN` is set), catalogue files traced into the bundles, and guards that refuse to run a deployed
environment on embedded Postgres. What's left needs your accounts.

## 1. Neon — a separate project (never the Telos database)
1. console.neon.tech → New project → **FlowStack**, region **AWS London (eu-west-2)**, database `flowstack`.
2. Copy two connection strings from *Connect*:
   - **Pooled** (host contains `-pooler`) → `DATABASE_URL` (the app; transaction pooling is fine — the code uses no
     prepared statements, and advisory locks / `SET LOCAL ROLE` / `set_config(..., true)` are all transaction-scoped).
   - **Direct** (no `-pooler`) → `DATABASE_URL_UNPOOLED` (migrations).
   The Vercel ↔ Neon integration sets both automatically if you prefer it.
3. Migrations create the `flowstack_app` role and grant it to the owner role; Neon's owner role is allowed to do that.

## 2. Xero app redirect URIs
Xero matches redirect URIs exactly, and Vercel preview URLs change per deploy. Register stable URLs only:
- `https://<production-domain>/api/auth/xero/callback`
- `https://<project>-git-main-<team>.vercel.app/api/auth/xero/callback` (the branch alias, for the preview check)
Set `APP_URL` and `XERO_REDIRECT_URI` per Vercel environment to match.

## 3. Vercel
```bash
npm i -g vercel
vercel login
cd ~/flowstack && vercel link          # create project "flowstack"
```
Add these for **Preview** and **Production** (`vercel env add NAME preview` / `production`):

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon pooled URL |
| `DATABASE_URL_UNPOOLED` | Neon direct URL |
| `APP_URL` | the stable URL for that environment (https) |
| `XERO_MODE` | `live` |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | from developer.xero.com |
| `XERO_REDIRECT_URI` | `${APP_URL}/api/auth/xero/callback` |
| `TOKEN_ENC_KEY` | `openssl rand -base64 32` — **different per environment; losing it means everyone reconnects** |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `CRON_SECRET` | `openssl rand -hex 24` (Vercel Cron sends it as `Authorization: Bearer …`) |
| `ADMIN_EMAILS` | the admin emails, comma-separated (set in Vercel; checked live on every /admin page) |
| `LLM_ENABLED` | `false` (or `true` + `ANTHROPIC_API_KEY`) |
| `TAVILY_API_KEY` | needed for JS-rendered pricing pages (see NOTES.md, live crawl) |
| `SENTRY_DSN` | optional |

Then:
```bash
vercel env pull .env.deploy --environment=preview
DOTENV=.env.deploy pnpm deploy:check   # settings + DB role + RLS; run after the first deploy has migrated
vercel deploy                          # preview; build runs `pnpm db:migrate && pnpm build`
```

## 4. Done when (BACKEND.md §14, M9)
1. `GET <preview>/api/health` → `{"ok":true,"missing":[]}`.
2. `DOTENV=.env.deploy pnpm deploy:check` → Ready.
3. `<preview>/api/auth/xero/start` → consent → lands on `/app/<org>` with the Demo Company's numbers.
4. In Neon's SQL editor: `select tenant_id, length(enc_access), length(enc_refresh) from xero_connections;` shows
   encrypted blobs (never readable tokens).
5. `vercel --prod` once the preview checks out.

## Git deploys (since 6 Nov 2026)
The Vercel project is connected to the private GitHub repo `vineigenphase/FlowStack` (free on Hobby for personal repos).
- **Push to `main` → Production** (https://flowstack-xi-ten.vercel.app). Merge to `main` only what should go live.
- **Push to `dev` → Preview** at the stable branch address https://flowstack-git-dev-flow-stack1.vercel.app (Preview
  `APP_URL`), running on the Neon `preview` branch. Other branches get previews too, at
  `https://flowstack-git-<branch>-flow-stack1.vercel.app`.
- Preview URLs sit behind Vercel's login (Deployment Protection); from the CLI use
  `MSYS_NO_PATHCONV=1 vercel curl /api/health --deployment <url>`.
- Vercel skips a commit it has already deployed, so a new branch at the same commit as `main` gets no preview until
  it has a commit of its own.
- `vercel deploy --prod` still works for an out-of-band deploy, but prefer merging to `main`.

## Neon branches per environment
- **Production** → Neon branch `production` (`br-curly-base-zavdocpe`).
- **Preview** → Neon branch `preview` (`br-shy-sun-za9iz0jm`), created from production on 6 Nov 2026 with all tenant
  data removed (orgs and everything under them, users, review queue, audit log). The catalogue and migration history
  were kept, so preview builds migrate cleanly. No expiry (made with `neon branches create`, not `neon checkout`).
- Point Vercel Preview at it: `bash scripts/vercel-preview-db.sh` (prints names only).
- Never copy production tenant data into preview. To reset preview, delete the branch, re-create it from production,
  and clear tenant data the same way before any preview deploy uses it.

## Crons
`vercel.json`: nightly 02:17 UTC (stale facts) and monthly 1st 03:41 UTC (catalogue crawl). Both are daily-or-less, so
they work on the Hobby plan. The monthly crawl runs inline (`maxDuration` 300s); if the catalogue grows past what fits,
move it to Inngest (BACKEND.md §14 M9 "optionally").

## Not for deployed environments
- `/api/dev/login` is disabled when `NODE_ENV=production` or `XERO_MODE` isn't `fixtures`.
- PGlite: `openDb` throws on Vercel without `DATABASE_URL`.
