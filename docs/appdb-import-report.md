# App database import report (ENGINE-V2 Phase 0)

Written: `data/xero-apps/listings.json` (unchanged from the last run). Source: `data/xero-apps/directory.json` (workbook 17 Nov 2026 + Xero listing pages read 2026-11-18); see `data/xero-apps/SOURCE.md`. No database writes: the table load and queue items are Phase 1 (migration 0025).

## 1. Rows

| | count |
|---|---|
| rows read | 728 |
| accepted | 728 |
| rejected | 0 |
| quarantined in the handoff, never read (RemitClear AL-0081, Deel AL-0557) | 2 |

Parts of a row left out (the row is kept; nothing is filled in):

| left out | reason | count |
|---|---|---|
| tier | billing period not stated | 44 |
| award | vendor's own claim, not an official Xero record | 6 |
| tier | free trial, not a price | 6 |
| tier | priced per transaction with no billing period | 2 |

## 2. Matching to `catalog/apps.yaml`

Order: reviewed crosswalk (`catalog/directory-crosswalk.yaml`) → website domain → exact name → fuzzy name ≥ 0.93. Unsure = a shared domain, a catalogue app claimed by two listings, or a name 0.80–0.93 similar.

| | listings |
|---|---|
| matched by exact name | 5 |
| matched by reviewed crosswalk | 2 |
| matched by website | 62 |
| **matched** | **69** |
| unsure → queue item `appdb_match` (Phase 1) | 6 |
| no catalogue app (not auto-created) | 653 |

Catalogue apps (84, excluding Xero itself) with no listing matched: **15**: `gusto`, `procure_wizard`, `lightspeed`, `google_workspace`, `microsoft_365`, `slack`, `modulr`, `capitalontap`, `cin7`, `brightpearl`, `equals`, `avalara`, `amazon_seller`, `chartmogul`, `baremetrics`.

Unsure matches, for a person:

| listing | name | catalogue candidates |
|---|---|---|
| `xa-approvalmgr` | ApprovalMGR | `approvalmax` (similar name (0.82)) |
| `xa-cin7-core` | Cin7 | `cin7` (same website (cin7.com), shared by 2 listings) |
| `xa-cin7-omni` | CIN7 Omni | `cin7` (same website (cin7.com), shared by 2 listings) |
| `xa-modulr` | Modulr | `modulr` (same website (modulrfinance.com), shared by 2 listings) |
| `xa-nook` | Modulr AP | `modulr` (same website (modulrfinance.com), shared by 2 listings) |
| `xa-solido` | Solido | `soldo` (similar name (0.83)) |

## 3. Field completeness (accepted rows)

| field | present | share | note |
|---|---|---|---|
| website | 728 | 100% |  |
| xero_categories | 714 | 98% | empty = no listing read |
| xero_functions | 494 | 68% | the listing's data-flow section |
| description | 728 | 100% | keyword matching + admin panel only |
| rating_avg | 498 | 68% | null = no reviews, or no listing |
| review_count > 0 | 498 | 68% |  |
| review_count = 0 | 225 | 31% | listed, no reviews yet (rating null, not low) |
| review_count null | 5 | 1% | no listing read |
| pricing_tiers (any) | 112 | 15% |  |
| a tier with a £ price | 111 | 15% | converted to £; null = quote, unknown, or no stated currency |
| a per-org £ tier | 74 | 10% | what Phase 1 price scoring can use directly |
| awards (official) | 15 | 2% | vendor claims are left out (see §1) |
| markets | 714 | 98% | empty = not read (not 'unsupported') |
| source_url | 728 | 100% |  |

Rating source: none 5, listing 714, workbook 9 (workbook = no readable listing; the workbook's figure is kept and labelled).

## 4. Candidates per category × market

Each cell: **all listings** / listings matched to a catalogue app / catalogue apps (apps.yaml) today. Owner decision 23 Nov 2026: **every listing is a v2 candidate** (the first number); the catalogue entry is used where a listing matches one.

| our category | UK | US | CA | AU |
|---|---|---|---|---|
| management_reporting | **157** / 16 / 8 | **127** / 16 / 7 | **120** / 16 / 7 | **135** / 16 / 8 |
| consolidation | **157** / 16 / 8 | **127** / 16 / 7 | **120** / 16 / 5 | **135** / 16 / 8 |
| data_capture | **136** / 15 / 5 | **98** / 12 / 4 | **87** / 10 / 3 | **97** / 10 / 5 |
| spend_payables | **166** / 23 / 16 | **106** / 17 / 10 | **93** / 15 / 3 | **104** / 16 / 8 |
| billing_receivables | **262** / 33 / 8 | **176** / 25 / 7 | **160** / 24 / 4 | **196** / 26 / 7 |
| payroll | **25** / 4 / 5 | **6** / 1 / 2 | **6** / 1 / 1 | **14** / 2 / 2 |
| rota | **62** / 9 / 5 | **44** / 6 / 2 | **39** / 6 / 2 | **53** / 7 / 3 |
| fx_banking | **69** / 16 / 4 | **36** / 10 / 3 | **31** / 9 / 2 | **34** / 9 / 3 |
| inventory | **60** / 6 / 7 | **50** / 5 / 7 | **51** / 5 / 4 | **58** / 6 / 5 |
| job_project | **198** / 17 / 9 | **140** / 15 / 9 | **129** / 15 / 3 | **163** / 17 / 10 |
| fpa | **157** / 16 / 5 | **127** / 16 / 4 | **120** / 16 / 1 | **135** / 16 / 4 |
| cash_forecasting | **157** / 16 / 5 | **127** / 16 / 3 | **120** / 16 / 2 | **135** / 16 / 4 |
| epos_ecommerce | **87** / 8 / 12 | **67** / 5 / 11 | **62** / 5 / 7 | **72** / 6 / 10 |
| compliance | **20** / 0 / 1 | **11** / 0 / 1 | **10** / 0 / 1 | **12** / 0 / 1 |
| month_end | **0** / 0 / 1 | **0** / 0 / 0 | **0** / 0 / 0 | **0** / 0 / 0 |
| other_software | **0** / 0 / 3 | **0** / 0 / 3 | **0** / 0 / 3 | **0** / 0 / 3 |

Categories with fewer than 3 catalogue apps in the UK (before the 23 Nov decision these would have needed a `catalog_gap` warning): compliance (UK: 1 catalogue app, 20 listings); month_end (UK: 1 catalogue app, 0 listings).

## 5. Xero labels not in the hand-typed maps

- Xero categories not in `catalog/xero-category-map.yaml`: none.
- Xero functions not in `catalog/xero-functions.yaml`: none.
- Mapped to no FlowStack category on purpose (never a gap candidate alone): "Convert data to Xero", "Loans, financing and credit", "Accountant tools", "Practice manager", "CRM and marketing", "Workflow builders", "Development partners", "Carbon accounting", "Other".

## 6. Terms check

Owner confirmed 23 Nov 2026: OK to use the App Store descriptions, ratings and review counts. Ratings are attributed "Xero App Store, captured <date>". No review text was collected.

## 7. Prices in pounds

Owner decision 23 Nov 2026: every price is shown in £. 58 tiers converted (USD 41, AUD 14, NZD 1, EUR 2) at ECB reference rates for 2026-11-20 (`catalog/fx-rates.yaml`); each keeps the vendor's own amount and currency. Not converted because the vendor states no currency ("$" could be USD, AUD, NZD or CAD): 2 (Fergus Basic; Fergus Professional (Pro)).
