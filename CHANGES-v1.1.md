# CHANGES-v1.1.md: cofounder review, 9 Nov 2026

> Applied to CLAUDE.md and BACKEND.md on 9 Nov 2026 (changelog at the top of BACKEND.md).
> Tags: **DECIDED** apply now · **PROPOSED** apply now, may be revised · **OPEN** do not build; leave a seam and a TODO pointing to §4.

## 1. At a glance

| # | Change | Status | Files |
|---|---|---|---|
| A | Users are any finance lead, not just the FD | DECIDED | CLAUDE §1, §8; copy |
| B | Monthly balance sheet and P&L (12 months) + trend signals (debtor, creditor, stock days) | DECIDED | BACKEND §3.4, §4, §7 |
| C | App lifecycle: what happens when an app's payments stop | PROPOSED | BACKEND §6 |
| D | "Not a problem" split into four reasons; new false-positive definition | PROPOSED | BACKEND §7, §10, §13 |
| E | Billing on Stripe | DECIDED (provider) / OPEN (prices) | CLAUDE §4; BACKEND new §20 |
| F | Recommendation types are **Add** and **Change**. No "drop", no "fix" in 1.0 | DECIDED | CLAUDE §1, §7.3; BACKEND §8 |
| G | Peer prices: ranges only, opt-in, legal sign-off first. Not in 1.0 | DECIDED (not in 1.0) / OPEN (legal) | CLAUDE §7.3b |
| H | Monday digest parked | DECIDED | CLAUDE §1 |
| I | Several businesses per user (accountants, bookkeepers, groups) + business switcher | DECIDED | BACKEND §3.5, §12, §13 |
| J | Vendors edit their own listings only once we have users | DECIDED | CLAUDE §1, §6 |
| K | New ranking weights: 0.50 / 0.35 / 0.10 / 0.05 | DECIDED | CLAUDE §7.3; BACKEND §8.3 |
| L | Dossier: what can be automated, and extra crawl pages | PROPOSED | BACKEND §11; CLAUDE §7.3b |
| M | Account mapping led by Xero's reporting code (tagging) + tax rate, with name synonyms | DECIDED | BACKEND §5 |
| N | Pricing hypotheses and unit costs | OPEN | BACKEND new §20 |
| O | Review incentive: "activators" | DECIDED (shape) / OPEN (threshold) | CLAUDE §7.5 |
| P | First industries: ecommerce and SaaS | DECIDED | CLAUDE §11; catalogue; fixtures |

## 2. Detail

The full text of each change is folded into BACKEND.md (§0, §3.4, §3.5, §4, §5, §6.1, §7.2–7.3, §8.3, §9, §10, §11, §12, §13, §14, §15, §18, §20) and CLAUDE.md (§1, §4, §6, §7.3, §7.3b, §7.5, §8, §11).

### N. Pricing hypotheses (OPEN)

| Item | Hypothesis |
|---|---|
| Subscription | £9.99–£24.99 per business per month |
| Up-front audit | £99–£249 one-off |
| Opening offer | Audit waived. Aim for 12-month sign-ups (unlikely for the first few customers) |
| Reference points | Cash flow forecasting ~£30/month; accruals ~£30/month; asset accounting ~£6/month; inventory £300–£700/month |

**Rough unit costs** (estimates; check current prices before deciding):

| Cost | Rough monthly amount |
|---|---|
| Xero Core: $35 AUD for 50 connections | ≈ £18 → ≈ £0.36 per connected business when full |
| Stripe on £19.99 (corporate card) | ≈ £0.72 |
| Claude for crawl extraction (Haiku, monthly) | a few £ for the whole catalogue |
| Hosting: Vercel + Neon at small scale | tens of £, fixed |

Gross margin per subscription is above 90%, and fixed costs are covered by roughly 5–10 paying businesses. The real constraints are churn after the first stack decision, and our own time on the review queue.

### P. Catalogue priority for the first 40 apps (enter by hand, `sample: true` until verified)

- **Ecommerce:** A2X, Link My Books, Shopify, Amazon, Cin7, Unleashed, Katana, Stripe, PayPal, GoCardless
- **SaaS:** Chargebee, ChartMogul, Baremetrics, Stripe Billing
- **Both:**
  - spend & payables: Pleo, Ramp, Spendesk, Dext, Hubdoc, ApprovalMax
  - chasing: Chaser
  - forecasting and reporting: Float, Fathom, Syft
  - payroll: Staffology, Employment Hero
  - month end: Easy Month End
- **Fixtures:** an ecommerce sample org and a SaaS sample org (anonymised, labelled sample).

## 3. Milestones

See BACKEND.md §14 ("v1.1 additions") and the new M10.

## 4. Open decisions (do not build; leave a TODO pointing here)

1. **Prices:** subscription level, audit fee, annual discount, firm per-client price (N).
2. **Peer price ranges:** legal + Xero partner sign-off (G).
3. **Activator threshold:** 3 reviews per free month? (O)
4. **Lapsing rule:** confirm "ask after one missed cycle + 15 days; inactive after two" (C).
5. **"Not a problem" answers:** confirm the four options and which count as false positives (D).
6. **Add vs Change:** confirm "no built-in preference, the score decides" (F).
