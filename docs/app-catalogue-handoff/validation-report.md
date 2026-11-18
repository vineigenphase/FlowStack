# Validation report

Run on 17 Nov 2026 against `FlowStack_App_Catalogue_revised.xlsx` after LibreOffice recalculation.

| check | result | detail |
|---|---|---|
| Original row counts preserved | PASS | App List 730->730; Apps by Line Item 1139->1139; Pricing Tiers 330->330 |
| Original cell values unchanged (excluding the 2 rebuilt count columns) | PASS | 0 differing cells |
| app_id unique | PASS | 728 app rows, 728 distinct |
| Listing URLs unique among apps | PASS | 723 with URL |
| Quarantined identity records | PASS | AL-0081 RemitClear (quarantined-probable-duplicate-record); AL-0557 Deel (quarantined-probable-duplicate-record) |
| Records merged | PASS | 0 (no merges performed) |
| FK fs_mappings.app_id -> apps (ready rows) | PASS | 0 orphans |
| FK pricing_tiers_norm.app_id -> apps | PASS | 0 orphans |
| FK app_regions.app_id -> apps | PASS | 24 rows, 0 orphans |
| FK app_languages.app_id -> apps | PASS | 2 rows, 0 orphans |
| FK app_store_functions.app_id -> apps | PASS | 4 rows, 0 orphans |
| FK app_listing_industries.app_id -> apps | PASS | 4 rows, 0 orphans |
| FK integration_dataflows.app_id -> apps | PASS | 5 rows, 0 orphans |
| FK app_awards.app_id -> apps | PASS | 21 rows, 0 orphans |
| Line-item rows resolved to an app record | PASS | name (unique): 1128, name + website + area: 11 |
| Mapping rows held back (quarantined source record) | PASS | 3 rows |
| mapping_status distribution (not one label for all) | PASS | heuristic-from-app-store-category: 1036, source-reported: 103 |
| Ratings within 0-5 | PASS | 0 out of range; missing ratings: 233 |
| Review counts non-negative integers | PASS | 0 invalid; missing counts: 5 |
| Zero rating with reviews > 0 | PASS | 0 |
| Pricing edge cases flagged | PASS | custom tier with a number: treat as from-price: 8, currency not stated ($ only or none): 19, zero price is a trial, not a free plan: 5, quote/custom: amount left blank: 27, period suspect (listing says per year): 7, quote with indicative from-price: 1 |
| Quote tiers: amount blank unless an explicit from-price | PASS | 28 quote tiers |
| Trials not marked as free plans | PASS |  |
| No currency inferred from "$" | PASS |  |
| FS line item labels covered by crosswalk | PASS | 41 labels; unmapped: 0 |
| Area values covered by crosswalk | PASS | 27 values |
| Formula errors (after LibreOffice recalculation) | PASS | 1497 formulas, 0 errors |
| Recalculated summary | PASS | Total=730; P&L=450; Balance Sheet=365; Cash Flow=109; KPI=215; Pricing still to verify on vendor site=545; Ready app_ids=728; Quarantined App List records=2; Mapping rows ready to import=1136; Mapping rows heuristic=1036; Pricing tiers linked=330; Pricing tiers flagged=61; Apps with listing metadata read=2; Official award rows=15 |
| Columns that will truncate on screen (long text, no wrap) | PASS | 47 columns - intentional for long raw-text fields; see list below |

## Columns that truncate on screen

These are long raw-text columns (descriptions, inclusions, URLs). They are left unwrapped on purpose so the row height stays readable. Widen or wrap them when you review.

- App List!P (Pricing tiers captured): longest 22 chars, width 12, no wrap
- App List!Q (app_id (proposed)): longest 47 chars, width 22, no wrap
- Apps by Line Item!M (app_id (proposed)): longest 47 chars, width 22, no wrap
- Pricing Tiers!K (app_id (proposed)): longest 36 chars, width 22, no wrap
- apps!A (app_id): longest 47 chars, width 28, no wrap
- apps!C (app_name): longest 45 chars, width 26, no wrap
- apps!D (app_name_raw): longest 45 chars, width 16, no wrap
- apps!F (website): longest 43 chars, width 12, no wrap
- apps!G (xero_listing_url): longest 73 chars, width 36, no wrap
- apps!H (xero_listing_slug): longest 44 chars, width 21, no wrap
- apps!L (xero_store_categories_raw): longest 53 chars, width 29, no wrap
- apps!M (description_raw): longest 91 chars, width 50, no wrap
- apps!N (industry_legacy_raw): longest 68 chars, width 23, no wrap
- apps!O (industry_legacy_status): longest 66 chars, width 30, no wrap
- apps!Q (business_size_status): longest 88 chars, width 34, no wrap
- apps!W (pricing_summary_raw): longest 276 chars, width 40, no wrap
- apps!AB (listed_date_source): longest 55 chars, width 22, no wrap
- identity_crosswalk!D (app_name_raw): longest 45 chars, width 26, no wrap
- identity_crosswalk!E (app_name_normalised): longest 45 chars, width 23, no wrap
- identity_crosswalk!F (website): longest 43 chars, width 12, no wrap
- identity_crosswalk!G (xero_listing_url): longest 73 chars, width 40, no wrap
- identity_crosswalk!J (proposed_app_id): longest 47 chars, width 28, no wrap
- identity_crosswalk!K (resolution_status): longest 37 chars, width 21, no wrap
- fs_mappings!B (app_id): longest 47 chars, width 28, no wrap
- fs_mappings!C (candidate_app_id): longest 47 chars, width 28, no wrap
- fs_mappings!N (xero_account_type_proposed): longest 72 chars, width 30, no wrap
- fs_mappings!O (xero_report_section_proposed): longest 71 chars, width 34, no wrap
- fs_mappings!T (mapping_status): longest 33 chars, width 18, no wrap
- fs_mappings!U (mapping_source): longest 96 chars, width 50, no wrap
- fs_mappings!Y (unresolved_reason): longest 93 chars, width 46, no wrap
- fs_line_item_crosswalk!D (new_column): longest 41 chars, width 14, no wrap
- fs_line_item_crosswalk!G (xero_account_type_proposed): longest 72 chars, width 32, no wrap
- fs_line_item_crosswalk!H (xero_report_section_proposed): longest 71 chars, width 34, no wrap
- pricing_tiers_norm!D (app_name_label): longest 36 chars, width 18, no wrap
- pricing_tiers_norm!E (tier_name): longest 51 chars, width 24, no wrap
- pricing_tiers_norm!F (price_raw): longest 138 chars, width 28, no wrap
- pricing_tiers_norm!J (billing_basis_raw): longest 75 chars, width 21, no wrap
- pricing_tiers_norm!R (region): longest 29 chars, width 12, no wrap
- pricing_tiers_norm!S (add_ons_and_usage_raw): longest 320 chars, width 40, no wrap
- pricing_tiers_norm!T (includes_raw): longest 945 chars, width 50, no wrap
- pricing_tiers_norm!U (description_raw): longest 343 chars, width 40, no wrap
- pricing_tiers_norm!V (source_type): longest 25 chars, width 15, no wrap
- pricing_tiers_norm!W (source_url): longest 62 chars, width 36, no wrap
- pricing_tiers_norm!AA (edge_case_flags): longest 86 chars, width 36, no wrap
- xero_taxonomy!A (kind): longest 21 chars, width 12, no wrap
- xero_taxonomy!B (value): longest 82 chars, width 32, no wrap
- xero_research_log!A (source_url): longest 72 chars, width 44, no wrap

## Sheet previews

Each sheet was rendered to PDF with LibreOffice (first 15 rows) and checked visually. Headers render, nothing is broken, and ID columns are wide enough. Long raw-text columns are clipped as listed above.

### Summary (46 rows)

| Area | No. of apps |
|---|---|
| Accountant Tools | 67 |
| Accounts Receivable | 18 |
| Billing | 4 |

### Notes (11 rows)

| Sources: all 723 apps on the Xero UK App Store (apps.xero.com/uk sitemap, listings read 14 Nov 2026), plus apps from the Mayday CFO Techstack map not listed on the UK store. Xero itself excluded. |
|---|
| Researched apps (Source = 'Researched'): |
| Xero-listing apps: area, FS line item an |
| Pricing highlighted yellow = not yet che |

### App List (730 rows)

| App | Website | Xero listing | Area | Xero categories | What it does | FS line items | Statements |
|---|---|---|---|---|---|---|---|
| AccountKit | https://account-kit.com | https://apps.xero.com/uk/app/accountkit | Accountant Tools | Accountant tools, Practice manager | AccountKit is the heart of your accounti | Practice & compliance reporting | KPI |
| Active Workpapers | https://active.businessfitness.com | https://apps.xero.com/uk/app/active-work | Accountant Tools | Accountant tools | Discover the power of Active Workpapers. | Practice & compliance reporting | KPI |
| Asset.Guru | https://asset.guru | https://apps.xero.com/uk/app/assetguru | Accountant Tools | Accountant tools | Have more than 500 fixed assets? Need de | Practice & compliance reporting | KPI |

### Apps by Line Item (1139 rows)

| App | Website | Area | What it does | FS line item | Statement | Pricing (as at Nov 2026, ex VAT) | Industry |
|---|---|---|---|---|---|---|---|
| AccountKit | https://account-kit.com | Accountant Tools | AccountKit is the heart of your accounti | Practice & compliance reporting | KPI | Compliance £20/mo; Professional £40/mo;  | Accounting firms |
| Active Workpapers | https://active.businessfitness.com | Accountant Tools | Discover the power of Active Workpapers. | Practice & compliance reporting | KPI | Not yet checked on vendor site | Accounting firms |
| Asset.Guru | https://asset.guru | Accountant Tools | Have more than 500 fixed assets? Need de | Practice & compliance reporting | KPI | Not yet checked on vendor site – 21-day  | Accounting firms |

### Pricing Tiers (330 rows)

| App | Area | Tier / plan | Price (ex VAT unless stated) | Billing basis | Tier description / limits | What the tier includes | Add-ons & extra charges |
|---|---|---|---|---|---|---|---|
| AccountKit | Accountant Tools | Compliance | £20/mo | Per User | Drive ultimate efficiency with our suite | Suite of compliance tools / Business str | Metered: £30/month [Usage-based (per par |
| AccountKit | Accountant Tools | Professional | £40/mo | Per User | Powerup your practice with advanced prac | All of Compliance / Outlook & Gmail Inte | Metered: £30/month [Usage-based (per par |
| AccountKit | Accountant Tools | Practice | £60/mo | Per User | Standardise and control all work and sys | All of Professional / Extensive Workflow | Metered: £30/month [Usage-based (per par |

### apps (728 rows)

| app_id | app_id_status | app_name | app_name_raw | primary_record_id | website | xero_listing_url | xero_listing_slug |
|---|---|---|---|---|---|---|---|
| xa-accountkit | proposed | AccountKit | AccountKit | AL-0002 | https://account-kit.com | https://apps.xero.com/uk/app/accountkit | accountkit |
| xa-active-workpapers | proposed | Active Workpapers | Active Workpapers | AL-0003 | https://active.businessfitness.com | https://apps.xero.com/uk/app/active-work | active-workpapers |
| xa-assetguru | proposed | Asset.Guru | Asset.Guru | AL-0004 | https://asset.guru | https://apps.xero.com/uk/app/assetguru | assetguru |

### identity_crosswalk (731 rows)

| record_id | source_sheet | source_row | app_name_raw | app_name_normalised | website | xero_listing_url | area_legacy |
|---|---|---|---|---|---|---|---|
| AL-0002 | App List | 2 | AccountKit | AccountKit | https://account-kit.com | https://apps.xero.com/uk/app/accountkit | Accountant Tools |
| AL-0003 | App List | 3 | Active Workpapers | Active Workpapers | https://active.businessfitness.com | https://apps.xero.com/uk/app/active-work | Accountant Tools |
| AL-0004 | App List | 4 | Asset.Guru | Asset.Guru | https://asset.guru | https://apps.xero.com/uk/app/assetguru | Accountant Tools |

### fs_mappings (1139 rows)

| mapping_id | app_id | candidate_app_id | record_id | li_source_row | match_method | statement | statement_is_xero_financial_statement |
|---|---|---|---|---|---|---|---|
| MAP-0002 | xa-accountkit | xa-accountkit | AL-0002 | 2 | name (unique) | KPI | no |
| MAP-0003 | xa-active-workpapers | xa-active-workpapers | AL-0003 | 3 | name (unique) | KPI | no |
| MAP-0004 | xa-assetguru | xa-assetguru | AL-0004 | 4 | name (unique) | KPI | no |

### fs_line_item_crosswalk (41 rows)

| statement | fs_line_item_legacy | mapping_rows | new_column | label_kind | xero_account_class_proposed | xero_account_type_proposed | xero_report_section_proposed |
|---|---|---|---|---|---|---|---|
| Balance Sheet | Accruals | 1 | fs_line_item_legacy (value kept verbatim | statement line | LIABILITY | CURRLIAB | Balance Sheet Liability |
| Balance Sheet | Accruals (committed spend) | 1 | fs_line_item_legacy (value kept verbatim | statement line + qualifier | LIABILITY | CURRLIAB | Balance Sheet Liability |
| Balance Sheet | Borrowings | 13 | fs_line_item_legacy (value kept verbatim | statement line | LIABILITY | CURRLIAB / TERMLIAB / LIABILITY | Balance Sheet Liability |

### area_crosswalk (27 rows)

| area_legacy | app_rows | app_function_area_proposed | reason | approval_status |
|---|---|---|---|---|
| Accountant Tools | 67 | accountant_tools | App function area (what the app does). N | proposed - owner to approve |
| Accounts Receivable | 18 | accounts_receivable | App function area (what the app does). N | proposed - owner to approve |
| Billing | 4 | billing | App function area (what the app does). N | proposed - owner to approve |

### pricing_tiers_norm (330 rows)

| tier_id | app_id | link_method | app_name_label | tier_name | price_raw | amount | currency |
|---|---|---|---|---|---|---|---|
| TIER-0002 | xa-accountkit | source URL slug | AccountKit | Compliance | £20/mo | 20 | GBP |
| TIER-0003 | xa-accountkit | source URL slug | AccountKit | Professional | £40/mo | 40 | GBP |
| TIER-0004 | xa-accountkit | source URL slug | AccountKit | Practice | £60/mo | 60 | GBP |

### app_regions (24 rows)

| app_id | region_code | region_name | in_listing_regions | in_supported_regions | evidence_status | source_url | checked_at |
|---|---|---|---|---|---|---|---|
| xa-float-cashflow-forecasting | au | Australia | TRUE | TRUE | source-reported | https://apps.xero.com/uk/app/float-cashf | 2026-11-17 |
| xa-float-cashflow-forecasting | gb | United Kingdom | TRUE | TRUE | source-reported | https://apps.xero.com/uk/app/float-cashf | 2026-11-17 |
| xa-float-cashflow-forecasting | nz | New Zealand | TRUE | TRUE | source-reported | https://apps.xero.com/uk/app/float-cashf | 2026-11-17 |

### app_languages (2 rows)

| app_id | language_code | language_name | evidence_status | source_url | checked_at |
|---|---|---|---|---|---|
| xa-float-cashflow-forecasting | en | English | source-reported | https://apps.xero.com/uk/app/float-cashf | 2026-11-17 |
| xa-a2x | en | English | source-reported | https://apps.xero.com/uk/app/a2x | 2026-11-17 |
|  |  |  |  |  |  |

### app_store_functions (4 rows)

| app_id | xero_store_function_id | xero_store_function_name | kind | evidence_status | source_url | checked_at |
|---|---|---|---|---|---|---|
| xa-float-cashflow-forecasting | reporting | Reporting and forecasting | app-store category (not a verified capab | source-reported | https://apps.xero.com/uk/app/float-cashf | 2026-11-17 |
| xa-float-cashflow-forecasting | accountant-tools-extras | Accountant tools | app-store category (not a verified capab | source-reported | https://apps.xero.com/uk/app/float-cashf | 2026-11-17 |
| xa-a2x | ecommerce | Ecommerce | app-store category (not a verified capab | source-reported | https://apps.xero.com/uk/app/a2x | 2026-11-17 |

### app_listing_industries (4 rows)

| app_id | xero_industry_id | xero_industry_name | evidence_status | source_url | checked_at |
|---|---|---|---|---|---|
| xa-float-cashflow-forecasting | not-for-profit | Not for profit | source-reported | https://apps.xero.com/uk/app/float-cashf | 2026-11-17 |
| xa-float-cashflow-forecasting | professional-services | Professional services | source-reported | https://apps.xero.com/uk/app/float-cashf | 2026-11-17 |
| xa-float-cashflow-forecasting | construction-trades | Construction and trades | source-reported | https://apps.xero.com/uk/app/float-cashf | 2026-11-17 |

### integration_dataflows (5 rows)

| app_id | xero_object | xero_object_id | flow_raw | flow_meaning | evidence_status | source_url | checked_at |
|---|---|---|---|---|---|---|---|
| xa-a2x | Invoices | invoices-in | in | app sends data into Xero (per listing) | source-reported | https://apps.xero.com/uk/app/a2x | 2026-11-17 |
| xa-a2x | Accounts | accounts-exchange | exchange | two-way (per listing) | source-reported | https://apps.xero.com/uk/app/a2x | 2026-11-17 |
| xa-a2x | Tracking Categories | trackingcategories-out | out | app reads data from Xero (per listing) | source-reported | https://apps.xero.com/uk/app/a2x | 2026-11-17 |

### app_awards (21 rows)

| award_id | app_id | award_program | award_year | award_category | result | evidence_status | source_url |
|---|---|---|---|---|---|---|---|
| AW-001 | xa-joiin | Xero Global App Awards | 2025 | unknown (collection covers Global/Region | winner (listed in Xero "Award-winning ap | verified | https://apps.xero.com/uk/collection/awar |
| AW-002 | xa-accountkit | Xero Global App Awards | 2025 | unknown (collection covers Global/Region | winner (listed in Xero "Award-winning ap | verified | https://apps.xero.com/uk/collection/awar |
| AW-003 | xa-servicem8 | Xero Global App Awards | 2025 | unknown (collection covers Global/Region | winner (listed in Xero "Award-winning ap | verified | https://apps.xero.com/uk/collection/awar |

### xero_taxonomy (70 rows)

| kind | value | meaning | source_url | source_location |
|---|---|---|---|---|
| account_class | ASSET | Account class (read-only field Class on  | https://github.com/XeroAPI/Xero-OpenAPI/ | Accounting API spec v20.1.0, components. |
| account_class | EQUITY | Account class (read-only field Class on  | https://github.com/XeroAPI/Xero-OpenAPI/ | Accounting API spec v20.1.0, components. |
| account_class | EXPENSE | Account class (read-only field Class on  | https://github.com/XeroAPI/Xero-OpenAPI/ | Accounting API spec v20.1.0, components. |

### xero_research_log (5 rows)

| source_url | source | established | not_established | read_on |
|---|---|---|---|---|
| https://github.com/XeroAPI/Xero-OpenAPI/ | Xero Accounting API OpenAPI spec (offici | Account Class enum (5 values); AccountTy | Per-type descriptions and the type-to-cl | 2026-11-17 |
| https://github.com/XeroAPI/Xero-OpenAPI/ | Xero Finance API OpenAPI spec (official) | P&L sections: Revenue (Trading Income, O | How each tenant account rolls into a sec | 2026-11-17 |
| https://www.xero.com/uk/glossary/chart-o | Xero UK glossary: chart of accounts | 5 main account types: assets, liabilitie | Glossary gives examples (e.g. wages as a | 2026-11-17 |

### engine_input_contract (14 rows)

| factor_type | factor | input_table_fields | proposed_role | missing_data_rule |
|---|---|---|---|---|
| compatibility | country/region support | app_regions | hard filter candidate | Unknown region list = unresolved, not in |
| compatibility | language support | app_languages | hard filter candidate | Unknown = unresolved |
| compatibility | Xero data objects read/written | integration_dataflows | hard filter candidate (e.g. needs Invoic | Listing claim only; not tested |

### data_dictionary (219 rows)

| table | field | type | key | description | nulls |
|---|---|---|---|---|---|
| apps | app_id | text | PK | Proposed stable app identifier. xa-<Xero | 0 of 728 null |
| apps | app_id_status | text |  | proposed = generated here; replace with  | 0 of 728 null |
| apps | app_name | text |  |  | 0 of 728 null |

### change_log (16 rows)

| date | sheet | change | rows affected |
|---|---|---|---|
| 2026-11-17 | Workbook | Created revised copy; original 5 sheets  | n/a |
| 2026-11-17 | App List | Added columns Q app_id (proposed) and R  | 730 rows |
| 2026-11-17 | App List | Rebuilt "No. of line items" (I) and "Pri | 730 formulas x 2 |

### research_backlog (10 rows)

| priority | item | next action | scope remaining |
|---|---|---|---|
| P1 | Listing metadata (countries, languages,  | Run scripts/fetch_xero_listing_metadata. | 721 of 723 listings not yet read (2 seed |
| P1 | Vendor pricing | Check vendor pricing pages; add tiers to | 545 App List rows still say "Not yet che |
| P1 | Identity decisions | Decide RemitClear (AL-0081 vs AL-0172) a | 2 quarantined records + their 3 mapping  |

### unresolved_questions (10 rows)

| area | question |
|---|---|
| Identity | RemitClear and Deel each have a second r |
| Rename | Approve proposed column names app_functi |
| Categorisation | Non-P&L rows (Balance Sheet, Cash Flow,  |

