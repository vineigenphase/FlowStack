# Unresolved questions and research backlog

These need an owner decision or more research. Nothing here has been guessed into the data.

## Owner decisions

1. **Identity:** RemitClear and Deel each have a second record without a Xero listing and with different mappings. Merge or keep separate?
2. **Rename:** Approve proposed column names app_function_area (from Area) and fs_line_item_legacy (from FS line item), and the crosswalk values.
3. **Categorisation:** Non-P&L rows (Balance Sheet, Cash Flow, KPI): no General P&L step, a balance-sheet equivalent, or a separate chain?
4. **Categorisation:** KPI rows are app functions, not a Xero statement. Move them to an app-function tag table?
5. **Categorisation:** Define the FlowStack General P&L and Further categorisation value lists.
6. **Status:** "recc" = recommended (confirmed). Where is it stored, and what storage/UI naming do you want? (Claude Code to inspect.)
7. **Engine:** Weights, listing-age direction, award decay, tie-breaks, exclusion rules, and the size of the top-recommendations list.
8. **Engine:** Is budget a hard filter or a ranking signal? How should quote-only prices be treated?
9. **Stress test:** What input or action currently shows nothing, and what did you expect to see?
10. **Pricing:** Starshipit and Collects.io tiers are labelled per year on Xero but look monthly. Accept as listed or confirm with vendor?

## Mappings that need review in Claude Code

- All 1,036 `heuristic-from-app-store-category` rows in `fs_mappings`. They were mapped from each app's primary Xero App Store category, not from accounts.
- All 103 `source-reported` rows. These are workbook claims with no field-level URL.
- `xero_account_class_proposed` / `xero_account_type_proposed` / `xero_report_section_proposed` come from the crosswalk proposal and must be approved before anything is promoted into `xero_category`.
- The 3 quarantined mapping rows from RemitClear AL-0081 and Deel AL-0557 are in `quarantine/fs_mappings_quarantined.csv`.
- KPI (215 rows) and Cash Flow (109 rows) branches: see `fs_line_item_crosswalk.label_kind`.

## Research backlog

| priority | item | next action | remaining |
|---|---|---|---|
| P1 | Listing metadata (countries, languages, listed date, functions, industries, data flows, free trial) | Run scripts/fetch_xero_listing_metadata.py against csv/apps.csv; review fetch_log; append to the linked tables. | 721 of 723 listings not yet read (2 seeded; 9 listings return 404) |
| P1 | Vendor pricing | Check vendor pricing pages; add tiers to pricing_tiers_norm with source_url and checked_at. | 545 App List rows still say "Not yet checked on vendor site" |
| P1 | Identity decisions | Decide RemitClear (AL-0081 vs AL-0172) and Deel (AL-0557 vs AL-0556): merge into one product with two source records, or keep separate. | 2 quarantined records + their 3 mapping rows |
| P1 | Tenant chart of accounts | Supply a read-only Accounts export (GET /Accounts) for a real organisation to populate xero_account_name / codes / reporting codes. | all 1,139 mappings |
| P2 | Xero account-type descriptions | Read developer.xero.com Types page (JavaScript-rendered) and record each type description and class. | 18 types |
| P2 | Award categories | Match each of the 15 official 2025 winners to its exact category from Xero's awards announcement; record 2026 results when published. | 15 apps |
| P2 | Pricing edge cases | Review rows flagged in pricing_tiers_norm.edge_case_flags (currency, suspect yearly period, quote, trial). | see validation |
| P2 | Business size | Verify business size (currently default SME for Xero-listing apps). | ~700 rows |
| P3 | Missing listing URLs | Pinch, Pento, Cledara, Spendesk, Weel are not on the Xero UK store: confirm availability in other regions. | 5 apps |
| P3 | 404 listings | Hindsight, Jack, TradeMore, HomeBozz, Invoice Tracker, Redcat, Pluto, Yordex, ClockIt listings return 404: confirm delisted. | 9 apps |

## Stress-testing note (kept as stated)

> "Stress testing using the database and showing nothing". This is not interpreted. Ask: what input or action gave no output, and what should have appeared? Empty-database, no-compatible-app and incomplete-data tests are proposed only as engineering safeguards.
