# Change log

Source workbook: `Xero_App_Ecosystem_with_Pricing.xlsx` (the 17 Nov 2026 version audited in the handoff brief). Revised copy: `FlowStack_App_Catalogue_revised.xlsx`. The original file was not modified.

| date | sheet | change | rows |
|---|---|---|---|
| 2026-11-17 | Workbook | Created revised copy; original 5 sheets kept with all values, styles and formulas except the two name-based count columns noted below. | n/a |
| 2026-11-17 | App List | Added columns Q app_id (proposed) and R record_status. | 730 rows |
| 2026-11-17 | App List | Rebuilt "No. of line items" (I) and "Pricing tiers captured" (P) to count by app_id instead of app name. Quarantined records (AL-0081 RemitClear, AL-0557 Deel) now show 0 rather than double-counting. | 730 formulas x 2 |
| 2026-11-17 | Apps by Line Item | Added columns M app_id (proposed) and N mapping_id. | 1,139 rows |
| 2026-11-17 | Pricing Tiers | Added columns K app_id (proposed) and L tier_id. Linked by listing URL slug (Xero rows) or unique name (vendor rows). | 330 rows |
| 2026-11-17 | apps | New normalised app table (728 ready app_ids). Keeps raw rating/reviews, industry, size, pricing text; adds status columns and listing facts where read. | 728 rows |
| 2026-11-17 | identity_crosswalk | One row per App List record + alias row for the MMC Excel Converter whitespace label. | 731 rows |
| 2026-11-17 | fs_mappings | One row per Apps by Line Item row with new chain columns (empty where unverified) and per-row mapping_status from its legacy Source. | 1,139 rows |
| 2026-11-17 | fs_line_item_crosswalk / area_crosswalk | Proposed old->new crosswalks for owner approval. Nothing renamed in place. | 41 + 27 rows |
| 2026-11-17 | pricing_tiers_norm | Structured price fields parsed from raw text; raw kept; quotes/unknown currencies left blank; edge cases flagged. | 330 rows |
| 2026-11-17 | app_regions / app_languages / app_store_functions / app_listing_industries / integration_dataflows | New linked tables. Seeded from 2 fully read Xero listings (A2X, Float); remaining 721 via scripts/fetch_xero_listing_metadata.py. | see counts |
| 2026-11-17 | app_awards | 15 official 2025 Xero Global App Award winners (Xero App Store collection) + 6 vendor-claimed award rows kept separate. | 21 rows |
| 2026-11-17 | xero_taxonomy / xero_research_log | Official Xero account classes, account types, system accounts, report sections and statements with citations. | 70 + 5 rows |
| 2026-11-17 | engine_input_contract | Proposed factors and missing-data rules; no weights or scores. | 14 rows |
| 2026-11-17 | Notes / Summary | Notes extended; Summary gains an ID-based handoff block. Existing Summary formulas unchanged. |  |
| 2026-11-17 | Merges | No records merged. No names changed in place. No values deleted. | 0 |
