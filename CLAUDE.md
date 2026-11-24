# CLAUDE.md — FlowStack (placeholder name; was "Stacksmith")

> Read this whole file before writing code. It is the product spec, the architecture and the rules of the road.
> When something here conflicts with a request in chat, ask before deviating.
> **Backend 1.0 is specified in BACKEND.md.** Where it conflicts with §3, §6 or §7 below (reports-first, derived cash flow, no Finance API, materiality, review queue), BACKEND.md wins.
> **Local dev deviations from the specs are recorded in NOTES.md.** Read it too.
> **v1.1 (9 Nov 2026):** cofounder review applied from CHANGES-v1.1.md; changelog at the top of BACKEND.md. Items tagged OPEN there are not built.

## 1. What we're building

**FlowStack tells a Xero business which apps to add or change — based on what its own ledger says — and then checks the app is actually working after install.** (v1.1 F: no "drop"; "fix" is reserved for 2.0.)

The finance lead (FD, financial controller, finance manager or head of finance) connects Xero (read-only). Accountants and bookkeepers with several businesses switch between them (BACKEND §3.5). We read bills, invoices, manual journals, contacts and bank transactions and produce:

1. **Diagnosis** — apps already in use (detected from supplier bills), and *signals* in the books that show manual work (e.g. 14 manual payroll journals/month, £62k receivables >30 days, 61% of bills keyed by hand).
2. **Recommendations** — ranked apps per gap, including **integration chains** (e.g. legacy Deputy → Staffology → Xero), price band for a business their size, time saved, and peer reviews.
3. **Stack map** — Xero at the core, every finance function around it, gaps highlighted.
4. **Ask** — natural-language questions ("inventory app for Xero for hospitality") answered against *their* ledger and stack, not a generic directory.
5. **Verified reviews** — you can only review an app whose bills appear in your own ledger. Reviews include price band paid and a 90-day "support after go-live" re-rate.
6. **After install** — day 7 / 30 / 90 check-ins computed from the ledger (is the target workflow now flowing through the app? did the signal move?), plus a price check 60 days before renewal.

### Why this wins (the gaps we exploit)
| Existing option | What it misses |
|---|---|
| Mayday CFO Techstack app map | Not personalised, no prices, no post-onboarding view |
| Xero App Store | Rankings per category, not a full ecosystem; some relevant apps missing from industry filters (e.g. Staffology under hospitality › payroll) |
| G2 | Generic AI search fails basic Xero + industry questions |
| Google | Sponsored results and vendor-written "best X" listicles |
| Finance Slack communities | Genuine reviews, but unstructured and unsearchable |

**Moat:** ledger-verified reviews + post-install outcome data. Nobody else can prove a reviewer pays for the app or measure whether it worked.

### Who pays (firm-first)
- **Practice plan — primary.** Accounting firms and fractional CFOs managing many Xero clients. They choose stacks every month, and FlowStack turns that into billable advisory work. Price per connected client (to test: ~£15–25/client/month, minimum ~£250/month).
- **Pro — £100/month per Xero org** (hypothesis). In-house finance teams at £2m–£50m revenue SMEs. Secondary.

### Firm UX (design reference: the FlowStack canvas)
1. **Practice home**: every client ranked by hours lost to manual work, a 5-segment flow bar per client (sales · payroll · purchases · collections · payments: clean / part manual / by hand), filters (fixes ready, proposal out, watching), and an "ask across all clients" bar.
2. **Playbooks**: the firm defines its standard stack per industry; FlowStack flags clients that drift from it.
3. **Client money flow**: where money starts → what carries it → which Xero account it lands in (real account codes, e.g. 477 Wages and Salaries). Broken flows dashed. Fixes are numbered in the order to do them (dependencies matter: fix Dext before adding Procure Wizard), each with the ledger evidence behind it.
4. **Client proposal**: firm-branded, the client toggles fixes and sees time back and its value; the firm's fee is the firm's to set. "No app pays to appear" footer.
5. **After install**: adoption chart against target + day 7/30/90/renewal check-ins.
6. **Later: firm plan — Monday digest** (parked, v1.1 H): a weekly email for accountancy firms summarising all their clients — wins (e.g. "debtor days fell 9 days after adding Chaser"), clients that need the partner, proposals still waiting. Only makes sense once firms connect many clients. Not in 1.0.
- Visual system (**owner restyle 22 Nov 2026; designer may revise**, ENGINE-V2 Phase 3): clean and corporate. Light by default, dark only when the user picks it in Settings. Colours live only in `app/tokens.css` (a test enforces it): page `--bg #F7F8FA`, cards on `--surface` white with `--border` and `--shadow-1`, text `#101828`, primary blue `#1D4ED8` for actions, links, the selected tab and the £ at stake (no highlighter). Status tags have a soft fill, dark text and always words: "Look at this" warning-soft, "Covered" success-soft, "Fine" neutral, "Checking" warning outline. Inter for headings and body with tabular figures; IBM Plex Mono only for account codes and IDs. Scale 32/40 page title, 20/28 section, 15/22 body, 13/18 small, 12 uppercase labels. 24 px gaps, max width 1200 px, tables with 44 px rows and a sticky header. No gradients, emoji or icon-per-heading.
  - Was (until 22 Nov 2026): ink rail, white surface, highlighter yellow `#FFE04A` for "needs action", orange dashed for by-hand, Archivo wide headings, Instrument Sans body, Plex Mono figures.
- Note: Xero's **Bulk Connections** (one OAuth for many client orgs) is Advanced-plan only. Until then, onboard firm clients one connection at a time and make that flow fast.
- **Never** sell ranking. Vendors may claim and correct their listing for free **once we have meaningful usage** (v1.1 J: keep `apps.claimed_by`, no vendor portal in 1.0); paid placement would destroy the product. Any future vendor revenue must be clearly separated from ranking (e.g. paid analytics on anonymised demand), and disclosed.

## 2. Hard constraints (do not violate)

1. **Read-only.** Request only read scopes. We never write to a customer's ledger.
2. **No AI/ML training on Xero data.** Xero's Developer Platform Terms (in force from 2 Mar 2026) prohibit using API data to train or contribute to AI/ML models. So:
   - LLMs are used for **inference only** (Ask answers, explanation text), per request, per tenant.
   - Send the LLM **derived features** (counts, ratios, detected app names), not raw transactions, wherever possible.
   - No fine-tuning, no shared vector index built from ledger data, use zero-data-retention API settings.
   - Peer benchmarks are plain aggregate statistics (medians, percentiles) with k-anonymity (k ≥ 10), not models.
   - Re-read the current terms before shipping anything AI-adjacent: https://developer.xero.com/xero-developer-platform-terms-conditions
3. **No bots or browser automation against Xero.** Terms prohibit simulating user actions. API only.
4. **No scraping of competitors** (Mayday, G2). Build our own catalogue (see §6).
5. **Tenant isolation.** Every query scoped by `org_id`; Postgres row-level security on.
6. **Reviews law.** UK DMCC Act 2024 rules on fake and incentivised reviews apply: label incentivised reviews, never write or seed reviews ourselves, keep an audit trail. Check current CMA guidance before launch.
7. **Sample data stays labelled.** Anything invented for demos (orgs, reviews, prices) carries a visible "sample" label.

## 3. Xero platform facts that shape the architecture

Verify against https://developer.xero.com/pricing before relying on numbers — they changed in 2026.

| Plan | Connections | Monthly fee | Egress included | Notes |
|---|---|---|---|---|
| Starter | 5 | free | n/a | 1,000 calls/day/org. Design partners only |
| Core | 50 | $35 AUD | 10 GB | 5,000 calls/day/org |
| Plus | 1,000 | $245 AUD | 50 GB | Requires app certification |
| Advanced | 10,000 | $1,445 AUD | 250 GB | Security assessment; unlocks Journals endpoint |

- Overage egress: $2.40 AUD/GB. **Egress is the cost driver** → incremental sync only.
- **Do not depend on the Journals endpoint** (Advanced plan only). Build signals from: `Invoices` (ACCPAY + ACCREC), `ManualJournals`, `BankTransactions`, `Payments`, `Contacts`, `TrackingCategories`, `Organisation`, `Reports` (AgedReceivablesByContact, AgedPayablesByContact, ProfitAndLoss).
- Use `If-Modified-Since` + paging on every list call; subscribe to webhooks (invoices, contacts, credit notes) to trigger deltas instead of polling.
- Xero has moved to granular scopes — look up the current scope names in the OAuth2 docs and request the read-only accounting set + `offline_access`. Nothing with write.
- Tokens: short-lived access token, refresh token rotates on use. Store encrypted; refresh in a single-flight lock per tenant.
- Also respect the per-minute and concurrent-call limits; implement a per-tenant token-bucket and honour `Retry-After`.
- Certification for Plus requires live customers; plan the first 50 connections on Core.

## 4. Tech stack

- **App:** Next.js (App Router) + TypeScript, server actions for mutations, Tailwind for styling.
- **DB:** Postgres (Neon or Supabase) + Drizzle ORM + migrations in repo. RLS on all tenant tables.
- **Jobs:** Inngest (or Trigger.dev) for sync, signal computation, check-ins. No long work in request handlers.
- **Xero:** official `xero-node` SDK wrapped in our own `lib/xero/` client (rate limit, retries, egress metering).
- **LLM:** Anthropic API (Claude), inference only, behind `lib/llm/` with feature-only prompts. Log prompts without ledger rows.
- **Billing:** Stripe (v1.1 E, DECIDED): Checkout, Billing, Customer Portal, Stripe Tax once VAT-registered. Plans and prices live in `catalog/plans.yaml`, never in code; prices are OPEN (CHANGES-v1.1 §4 item 1), so test mode only. Xero App Store billing is retired, so we bill directly.
- **Auth:** "Sign in with Xero" for FDs + email magic link for advisors' team members.
- **Hosting:** Vercel (web) + Inngest cloud. Secrets in the platform's secret store; token encryption with libsodium sealed boxes, key from env.
- **Observability:** Sentry + structured logs (pino). Never log tokens or raw ledger payloads.

## 5. Repo layout

```
/app                    Next.js routes: (marketing), (app)/[org]/{diagnosis,recs,map,ask,reviews,after}
/components             UI; design tokens in /components/theme.css (port from prototype/stacksmith.html)
/lib/xero               OAuth, client wrapper, rate limiter, egress meter, sync cursors
/lib/sync               Incremental sync per endpoint → raw_* tables
/lib/detect             Vendor fingerprinting → detected_apps
/lib/signals            One file per signal; pure functions over SQL views → signals
/lib/rank               Rules + integration graph + scoring → recommendations
/lib/llm                Ask + explanation text (features in, prose out)
/lib/reviews            Proof-of-use verification, incentives, moderation
/lib/checkins           Day 7/30/90 + renewal jobs
/catalog                apps.yaml, fingerprints.yaml, integrations.yaml, rules.yaml (hand-curated, reviewed in PRs)
/db                     Drizzle schema + migrations + seed (Xero demo company fixtures)
/prototype              stacksmith.html — clickable reference for UX and copy
/tests                  vitest unit + Playwright e2e
```

## 6. Core domain model

```
orgs(id, xero_tenant_id, name, industry, headcount_band, revenue_band, plan, connected_at)
xero_tokens(org_id, enc_access, enc_refresh, expires_at)           -- encrypted
sync_cursors(org_id, endpoint, modified_since, last_run, egress_bytes)
raw_invoices / raw_manual_journals / raw_bank_txns / raw_contacts   -- minimal columns only, 24-month window
apps(id, name, category, subcategory, price_band, pricing_model, website, xero_listed, industries[], regions[])
fingerprints(app_id, pattern, kind: contact_name|bank_descriptor|journal_attachment)
integrations(from_app, to_app, kind: native|via_app|csv, direction, notes)    -- e.g. deputy→staffology native
detected_apps(org_id, app_id, first_seen, last_seen, monthly_cost, state: ok|underused|legacy, evidence jsonb)
signals(org_id, key, value numeric, severity, period, evidence jsonb, computed_at)
recommendations(org_id, app_id, fit, hours_saved, chain jsonb, reasons jsonb, kind: add|change, status)   -- v1.1 F
reviews(id, app_id, org_id, user_id, role, scores jsonb, price_paid_band, body, verified_months, incentivised bool, created_at)
review_followups(review_id, day, support_score, outcome_note)
checkins(org_id, app_id, day, metric_key, metric_value, status)
```

### Catalogue sources
1. Our own curation in `/catalog/*.yaml` (category taxonomy aligned with how FDs talk: Spend/AP, Billing/AR, Payroll, Rota, Inventory, Data ingestion, Reporting, Consolidation, FP&A, Cash forecasting, FX, Payments, Job management, EPOS).
2. Vendors claim and correct their own listing (free, moderated, never affects rank) — once we have users (v1.1 J).
3. Members submit missing apps and integration edges.
Check the Xero App Store terms before importing anything from it; prefer manual entry.

## 7. Engines

### 7.1 Detection (`lib/detect`)
- Normalise contact names (lowercase, strip Ltd/Limited/Inc/UK, punctuation).
- Match against `fingerprints` (exact → alias → fuzzy with a high threshold). Also scan bank descriptors and attachment filenames on manual journals (e.g. `deputy_timesheet_*.csv`).
- State rules: `legacy` = app present but its output reaches Xero via manual journals; `underused` = adoption metric below target (e.g. <70% of bills via Dext).

### 7.2 Signals (`lib/signals`) — start with these 10
| key | computation | gap category |
|---|---|---|
| manual_payroll_journals | manual journals/month hitting wages/PAYE/pension/tronc accounts | Payroll |
| ar_over_30 | £ and count of ACCREC >30 days overdue; debtor days | Billing/AR |
| ap_unpaid_ratio | unpaid ACCPAY value / total ACCPAY value | Spend/AP |
| bills_manual_share | bills without an ingestion-app source / all bills | Data ingestion |
| cogs_share_no_stock | COGS supplier spend share with no stock adjustment journals | Inventory |
| saas_vendor_count | distinct software vendors + total spend | Spend/AP (SaaS) |
| supplier_concentration | top supplier share of bill value | Cash forecasting |
| multi_entity | >1 connected org with intercompany contacts | Consolidation |
| fx_exposure | share of bills/invoices in non-base currency | FX |
| bank_feed_backlog | unreconciled bank lines older than 14 days | Data ingestion / bookkeeping |

Each signal is a pure function with a fixture-based unit test. Thresholds live in `catalog/rules.yaml`, not in code.

### 7.3 Ranking (`lib/rank`)
```
fit = 0.50 * signal_strength      (coverage × materiality)
    + 0.35 * compatibility        (integration graph: works with apps they keep; chains allowed up to 2 hops)
    + 0.10 * peer_outcome         (verified review scores + measured check-in outcomes; neutral 0.5 until 3.0)
    + 0.05 * price_fit            (price band vs. revenue band; neutral 0.5 when price is missing)
```
(v1.1 K. Weights live in `catalog/rules.yaml → scoring:`.)
- No built-in preference: the score decides. The app in use is always scored and shown next to the alternatives, so a **Change** is a visible choice, never a silent swap. Kinds are `add` and `change` (v1.1 F; confirm: CHANGES-v1.1 §4 item 6).
- Output 3–5 recommendations max, each with ledger evidence the user can click into.
- Exclusions: apps whose `industries` exclude the org's industry (e.g. manufacturing MRP for hospitality).

### 7.3b App dossier + situational ranking (`lib/dossier`) — core feature
Goal: an FD never has to dig through vendor sites, book demos or "request pricing" to decide. One page per decision (e.g. "Payroll for Copperpot") shows 3 ranked options and every fact needed to sign.

**Situation** = derived from the ledger + 2–3 questions: industry, sites, headcount, apps they must keep, must-haves (e.g. tronc), budget band. Must-haves are hard filters or flags; they never get averaged away.

**Ranking** = the §7.3 fit formula with weights set by the user's priority:
| Priority | fit | cost | speed to go live | support |
|---|---|---|---|---|
| Balanced | .40 | .20 | .20 | .20 |
| Lowest cost | .30 | .50 | .10 | .10 |
| Fastest live | .30 | .10 | .50 | .10 |
| Best support | .30 | .10 | .10 | .50 |
Every rank shows its one-line reason. An option that breaks a must-have is marked, never silently dropped.

**Dossier fields** (each stores `value`, `source`, `checked_at`; show source + date in the UI):
- Price: pricing model, setup fee, published or quote-only. 1.0 shows **published prices only** (with source and date) or "Not published · we're checking". Peer prices are out of 1.0 (v1.1 G, see below)
- Contract: minimum term, notice period, auto-renewal, data export on exit
- Fit: integrations with the apps they keep (direct sync / CSV / replaces it), industry must-haves, what posts to Xero and how (journal vs invoice, tracking categories)
- Going live: days to first use (peer median from check-ins), partner needed or not
- Security: certifications, data location, AI use of customer data, roles, audit trail, respects Xero lock dates
- Support: support-after-go-live score from verified reviews
- Vendor: age, ownership changes, price-rise history

**Where prices come from** (the moat: no vendor has to cooperate):
1. **OPEN, not in 1.0 (v1.1 G; CHANGES-v1.1 §4 item 2).** Ledger bills: the monthly amount each connected org pays a fingerprinted vendor → `price_observations`. One business's price must never be shown or inferable by another. If ever built: opt-in, a range (p25–p75) rounded to the nearest £5, only where ≥10 businesses contribute in that size band, never a single value, never a count below 10. Before building: written sign-off from a lawyer **and** Xero's partner team (Xero's terms treat combined data as user data and ban combining and supplying it to other apps or third parties).
2. Vendor-claimed listings (free, moderated; published price lists).
3. **Quote requests**: one click sends the situation (no ledger data) to the top 3 vendors; replies are entered in the same structure and land in the comparison. Track response time per vendor and show it.

Tables: `app_facts(app_id, field, value, source_url, checked_at, checked_by)`, `price_observations`, `quote_requests(id, org_id, app_ids[], situation jsonb, sent_at)`, `quote_replies(request_id, app_id, price, terms jsonb, received_at)`.

Design reference: `Compare` artboard on the FlowStack canvas.

### 7.4 Ask (`lib/llm`)
- Retrieve candidates from the catalogue with SQL/keyword + category match (no ledger embeddings).
- Prompt = question + org feature summary (industry, size band, detected apps, top signals) + candidate apps + review aggregates.
- Model must cite which signal or app each claim relies on; refuse to invent prices.

### 7.5 Reviews (`lib/reviews`)
- **Proof of use:** reviewer's org must have ≥2 months of bills from the app's fingerprint. Badge shows verified tenure.
- Fields: role, scores (setup, support after go-live, value, Xero sync), price paid band, free text.
- 90-day follow-up email to re-rate support after go-live.
- Incentive ("activators", v1.1 O, 3.0): active reviewers earn free months; it takes more than one review per month (proposed 3 approved reviews = 1 free month, max 3 a year; threshold OPEN, CHANGES-v1.1 §4 item 3). The reward never depends on rating or tone, every rewarded review is labelled "incentivised", rewards are audited (`reward_ledger`).
- Vendors can reply publicly; cannot edit, hide or reorder.

### 7.6 Check-ins (`lib/checkins`)
- When a user marks a recommendation as installed (or detection sees the new app's first bill), schedule day 7 / 30 / 90 jobs.
- Day 7: connection producing data. Day 30: adoption metric. Day 90: originating signal moved by ≥ target. Renewal −60: price vs. peer band.

## 8. UX rules (prototype is the reference)
- Open on a working state: after connect, the diagnosis page renders with real numbers within 2 minutes (show progress per endpoint).
- Every recommendation links to its evidence ("14 manual journals → see them").
- Write for finance people: plain words, £ figures, months, no "AI-powered". Address the user as "you" or "the finance lead", not "the FD" (v1.1 A).
- Light and dark themes from tokens; mobile works.

## 9. Build plan

**Phase 0 — validation (weeks 1–2)**
- Share the prototype with 10–15 FDs from finance Slack communities. Ask: would you connect Xero for this? Would you pay £100/mo? What would make you churn?
- Recruit 5 design partners (Starter plan cap = 5 connections).

**Phase 1 — MVP (weeks 3–8)**
- Xero OAuth + incremental sync for the endpoints in §3, egress meter, rate limiter.
- Catalogue: 80 apps across 12 categories, fingerprints, 60 integration edges.
- Detection + 6 signals + ranking + diagnosis/recs/map pages.
- Stripe Pro plan. Move to Core plan.

**Phase 2 — the moat (weeks 9–14)**
- Verified reviews + incentives + 90-day follow-ups.
- Check-ins and after-install page.
- Advisor multi-org plan.

**Phase 3 — scale**
- Ask, remaining signals, Xero App Store listing (certification, Plus plan), QuickBooks connector.

## 10. Working conventions
- `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm db:migrate`, `pnpm db:seed` (seeds a demo org from fixtures).
- TypeScript strict. Zod at every boundary (Xero responses, forms, LLM output).
- Tests: every signal and ranking rule has fixture tests; Playwright e2e for connect → diagnosis → recs.
- Fixtures come from the Xero Demo Company, anonymised. Never commit real customer data.
- PRs touching `/catalog` need a note on the source of each fact.
- Definition of done: types pass, tests pass, works in both themes at 400px width, no tokens or ledger rows in logs.

## 11. Open questions (decide with the founders, don't guess)
1. Single-org Pro vs. advisor-first go-to-market?
2. Is £100/mo justified once the initial stack is chosen, or does monitoring + renewal price checks carry it? Consider £100/mo with annual discount vs. a one-off audit fee + lower monitoring tier.
3. ~~Which industries first?~~ **Answered (v1.1 P): ecommerce and SaaS first** (the most Xero- and tech-native finance teams). Hospitality later.
4. How to cold-start reviews before we have members: invite reviewers from finance communities with proof-of-use, never write any ourselves.
