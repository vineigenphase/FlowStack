# Data dictionary

Generated from the revised workbook (`data_dictionary` sheet). Types are as exported to CSV.

**CSV conventions:** UTF-8, comma-separated, header row, RFC 4180 quoting. Null = empty field (never 0, never "N/A"). Booleans = `TRUE` / `FALSE`. Dates = ISO `YYYY-MM-DD` (date precision stated in a `*_precision` column where relevant). Numbers use `.` decimals, no thousands separators. Multi-value facts are separate rows in linked tables (`app_regions`, `app_languages`, …), never comma-joined. Legacy `*_raw` and `*_legacy` text fields are copied verbatim and may contain `;` or `,` separators from the source workbook. Do not split them programmatically.

**Evidence statuses:** `verified` = confirmed by us on an authoritative primary source on `checked_at`. `source-reported` = as stated by a source (Xero listing, vendor page or workbook claim) and not independently confirmed. `inferred` = derived by rule. `conflicting` = sources disagree. `unknown` = no evidence. Copied workbook claims are never upgraded to `verified`.


## apps

| field | type | key | description | nulls |
|---|---|---|---|---|
| `app_id` | text | PK | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. | 0 of 728 null |
| `app_id_status` | text |  | proposed = generated here; replace with repo ID via crosswalk in Claude Code. | 0 of 728 null |
| `app_name` | text |  |  | 0 of 728 null |
| `app_name_raw` | text |  |  | 0 of 728 null |
| `primary_record_id` | text |  | App List record this app row was built from. | 0 of 728 null |
| `website` | text |  |  | 0 of 728 null |
| `xero_listing_url` | text |  |  | 5 of 728 null |
| `xero_listing_slug` | text |  |  | 5 of 728 null |
| `xero_listing_read_status` | text |  |  | 0 of 728 null |
| `app_function_area` | text |  | Proposed rename of Area: what the app does. Snake-case code of the legacy value. Not a financial category. | 0 of 728 null |
| `area_legacy` | text |  | Original Area value, verbatim. | 0 of 728 null |
| `xero_store_categories_raw` | text |  |  | 0 of 728 null |
| `description_raw` | text |  |  | 0 of 728 null |
| `industry_legacy_raw` | text |  |  | 0 of 728 null |
| `industry_legacy_status` | text |  |  | 0 of 728 null |
| `business_size_legacy_raw` | text |  |  | 0 of 728 null |
| `business_size_status` | text |  |  | 0 of 728 null |
| `xero_rating` | number |  | Original workbook Xero rating, unchanged. | 233 of 728 null |
| `xero_reviews` | number |  | Original workbook review count, unchanged. | 5 of 728 null |
| `rating_status` | text |  | present / present-zero-reviews / missing. Missing is not a low rating. | 0 of 728 null |
| `xero_rating_listing_now` | number |  | Rating read from the listing on checked date (only where read). Raw xero_rating not overwritten. | 726 of 728 null |
| `xero_reviews_listing_now` | number |  |  | 726 of 728 null |
| `pricing_summary_raw` | text |  |  | 0 of 728 null |
| `legacy_source_label` | text |  |  | 0 of 728 null |
| `listed_date` | date (YYYY-MM-DD) |  | Date the app was first listed on the Xero App Store (listing field listedDate). Not founding date or scrape date. | 726 of 728 null |
| `listed_date_precision` | text |  |  | 726 of 728 null |
| `listed_date_status` | text |  |  | 0 of 728 null |
| `listed_date_source` | text |  |  | 726 of 728 null |
| `listed_date_checked_at` | date (YYYY-MM-DD) |  |  | 726 of 728 null |
| `free_trial_flag` | boolean (TRUE/FALSE) |  |  | 726 of 728 null |
| `free_trial_days` | text |  |  | 727 of 728 null |
| `ready_to_import` | boolean (TRUE/FALSE) |  | TRUE = linked to a resolved app_id; FALSE = quarantined/unresolved, keep visible but do not import. | 0 of 728 null |

## identity_crosswalk

| field | type | key | description | nulls |
|---|---|---|---|---|
| `record_id` | text | PK | Source-record reference AL-<App List row>. Provenance only, not identity. | 0 of 731 null |
| `source_sheet` | text |  |  | 0 of 731 null |
| `source_row` | number |  |  | 0 of 731 null |
| `app_name_raw` | text |  |  | 0 of 731 null |
| `app_name_normalised` | text |  |  | 0 of 731 null |
| `website` | text |  |  | 1 of 731 null |
| `xero_listing_url` | text |  |  | 7 of 731 null |
| `area_legacy` | text |  | Original Area value, verbatim. | 1 of 731 null |
| `legacy_source_label` | text |  |  | 0 of 731 null |
| `proposed_app_id` | text | FK |  | 0 of 731 null |
| `resolution_status` | text |  | resolved-unique / resolved-whitespace-normalised / resolved-distinct-listing / quarantined-probable-duplicate-record / alias-label-differs-from-App-List | 0 of 731 null |
| `ready_to_import` | boolean (TRUE/FALSE) |  | TRUE = linked to a resolved app_id; FALSE = quarantined/unresolved, keep visible but do not import. | 0 of 731 null |
| `resolution_note` | text |  |  | 719 of 731 null |

## fs_mappings

| field | type | key | description | nulls |
|---|---|---|---|---|
| `mapping_id` | text | PK |  | 0 of 1139 null |
| `app_id` | text | FK | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. | 3 of 1139 null |
| `candidate_app_id` | text |  | App the row probably belongs to. For quarantined rows app_id is blank and only this is filled. | 0 of 1139 null |
| `record_id` | text |  | Source-record reference AL-<App List row>. Provenance only, not identity. | 0 of 1139 null |
| `li_source_row` | number |  |  | 0 of 1139 null |
| `match_method` | text |  |  | 0 of 1139 null |
| `statement` | text |  | Original Statement value: P&L / Balance Sheet / Cash Flow / KPI. | 0 of 1139 null |
| `statement_is_xero_financial_statement` | text |  | Whether Xero publishes this as a financial statement (per Xero Finance API spec). KPI = no. | 0 of 1139 null |
| `fs_line_item_legacy` | text |  | Original FS line item value, verbatim. | 0 of 1139 null |
| `area_legacy` | text |  | Original Area value, verbatim. | 0 of 1139 null |
| `app_function_area` | text |  | Proposed rename of Area: what the app does. Snake-case code of the legacy value. Not a financial category. | 0 of 1139 null |
| `xero_category` | text (all null) |  | Reserved for an approved Xero category from the documented taxonomy. Empty until approved/verified. | 1139 of 1139 null |
| `xero_account_class_proposed` | text |  | Proposal only: Xero account class (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE) implied by the crosswalk. | 0 of 1139 null |
| `xero_account_type_proposed` | text |  | Proposal only: Xero account type codes / system accounts implied by the crosswalk. | 0 of 1139 null |
| `xero_report_section_proposed` | text |  | Proposal only: Xero report section (e.g. P&L Expense > Direct Cost). | 0 of 1139 null |
| `xero_account_name` | text (all null) |  | Tenant chart-of-accounts name. Only from a read-only export of a real organisation. Empty (awaiting export). | 1139 of 1139 null |
| `xero_secondary_category` | text (all null) |  | e.g. expenses, wages. Empty until taxonomy + tenant data support it. | 1139 of 1139 null |
| `general_pl` | text (all null) |  | FlowStack custom layer (not Xero). Empty; undefined for non-P&L rows pending owner decision. | 1139 of 1139 null |
| `further_categorisation` | text (all null) |  | FlowStack custom layer below general_pl. Empty. | 1139 of 1139 null |
| `mapping_status` | text |  | heuristic-from-app-store-category / source-reported / verified / conflicting / unverified / unknown | 0 of 1139 null |
| `mapping_source` | text |  | Where the mapping came from (citation or workbook claim). | 0 of 1139 null |
| `mapping_checked_at` | text (all null) |  | Date a person/agent actually checked the mapping against a source. Empty = not checked. | 1139 of 1139 null |
| `legacy_source_label` | text |  |  | 0 of 1139 null |
| `ready_to_import` | boolean (TRUE/FALSE) |  | TRUE = linked to a resolved app_id; FALSE = quarantined/unresolved, keep visible but do not import. | 0 of 1139 null |
| `unresolved_reason` | text |  |  | 448 of 1139 null |

## fs_line_item_crosswalk

| field | type | key | description | nulls |
|---|---|---|---|---|
| `statement` | text |  | Original Statement value: P&L / Balance Sheet / Cash Flow / KPI. | 0 of 41 null |
| `fs_line_item_legacy` | text |  | Original FS line item value, verbatim. | 0 of 41 null |
| `mapping_rows` | number |  |  | 0 of 41 null |
| `new_column` | text |  |  | 0 of 41 null |
| `label_kind` | text |  |  | 0 of 41 null |
| `xero_account_class_proposed` | text |  | Proposal only: Xero account class (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE) implied by the crosswalk. | 0 of 41 null |
| `xero_account_type_proposed` | text |  | Proposal only: Xero account type codes / system accounts implied by the crosswalk. | 0 of 41 null |
| `xero_report_section_proposed` | text |  | Proposal only: Xero report section (e.g. P&L Expense > Direct Cost). | 0 of 41 null |
| `suggested_treatment` | text |  |  | 11 of 41 null |
| `approval_status` | text |  |  | 0 of 41 null |

## area_crosswalk

| field | type | key | description | nulls |
|---|---|---|---|---|
| `area_legacy` | text | PK | Original Area value, verbatim. | 0 of 27 null |
| `app_rows` | number |  |  | 0 of 27 null |
| `app_function_area_proposed` | text |  |  | 0 of 27 null |
| `reason` | text |  |  | 0 of 27 null |
| `approval_status` | text |  |  | 0 of 27 null |

## pricing_tiers_norm

| field | type | key | description | nulls |
|---|---|---|---|---|
| `tier_id` | text | PK |  | 0 of 330 null |
| `app_id` | text | FK | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. | 0 of 330 null |
| `link_method` | text |  |  | 0 of 330 null |
| `app_name_label` | text |  |  | 0 of 330 null |
| `tier_name` | text |  |  | 0 of 330 null |
| `price_raw` | text |  |  | 0 of 330 null |
| `amount` | number |  | Numeric price. Blank when unknown or quote. 0 only for genuine free plans or listed zero prices (see flags). | 27 of 330 null |
| `currency` | text |  | ISO code when stated (GBP from £). Blank when only "$" or nothing is shown. | 45 of 330 null |
| `billing_period` | text |  | month / year / per transaction / blank if unknown. | 48 of 330 null |
| `billing_basis_raw` | text |  |  | 15 of 330 null |
| `billing_basis_norm` | text |  | flat / per_user / per_client / usage / custom / free / blank. | 61 of 330 null |
| `is_quote` | boolean (TRUE/FALSE) |  | TRUE when the tier is custom/quote/calculator-priced. | 0 of 330 null |
| `is_from_price` | boolean (TRUE/FALSE) |  |  | 0 of 330 null |
| `is_free_plan` | boolean (TRUE/FALSE) |  | TRUE only for an amount of 0 that is not a trial and not a quote. | 0 of 330 null |
| `is_trial` | boolean (TRUE/FALSE) |  | TRUE when tier name/description indicates a trial. | 0 of 330 null |
| `min_quantity` | number |  |  | 327 of 330 null |
| `tax_status` | text |  | "ex VAT (stated)" only when the source says so; otherwise unknown. | 0 of 330 null |
| `region` | text |  |  | 0 of 330 null |
| `add_ons_and_usage_raw` | text |  |  | 274 of 330 null |
| `includes_raw` | text |  |  | 0 of 330 null |
| `description_raw` | text |  |  | 116 of 330 null |
| `source_type` | text |  |  | 0 of 330 null |
| `source_url` | text |  |  | 0 of 330 null |
| `source_date` | date (YYYY-MM-DD) |  | Date the source was captured (claimed in workbook or this session). | 0 of 330 null |
| `checked_at` | text (all null) |  | Date actually checked in this pass. Empty when not re-checked. | 330 of 330 null |
| `evidence_status` | text |  | verified (confirmed on an authoritative primary source by us on checked_at) / source-reported (as stated by a source; not independently confirmed) / inferred / conflicting / unknown | 0 of 330 null |
| `edge_case_flags` | text |  | Semicolon-separated issues to review before use. | 269 of 330 null |
| `ready_to_import` | boolean (TRUE/FALSE) |  | TRUE = linked to a resolved app_id; FALSE = quarantined/unresolved, keep visible but do not import. | 0 of 330 null |

## app_regions

| field | type | key | description | nulls |
|---|---|---|---|---|
| `app_id` | text | FK | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. | 0 of 24 null |
| `region_code` | text |  |  | 0 of 24 null |
| `region_name` | text |  |  | 0 of 24 null |
| `in_listing_regions` | boolean (TRUE/FALSE) |  |  | 0 of 24 null |
| `in_supported_regions` | boolean (TRUE/FALSE) |  |  | 0 of 24 null |
| `evidence_status` | text |  | verified (confirmed on an authoritative primary source by us on checked_at) / source-reported (as stated by a source; not independently confirmed) / inferred / conflicting / unknown | 0 of 24 null |
| `source_url` | text |  |  | 0 of 24 null |
| `checked_at` | date (YYYY-MM-DD) |  | Date actually checked in this pass. Empty when not re-checked. | 0 of 24 null |
| `note` | text |  |  | 0 of 24 null |

## app_languages

| field | type | key | description | nulls |
|---|---|---|---|---|
| `app_id` | text | FK | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. | 0 of 2 null |
| `language_code` | text |  |  | 0 of 2 null |
| `language_name` | text |  |  | 0 of 2 null |
| `evidence_status` | text |  | verified (confirmed on an authoritative primary source by us on checked_at) / source-reported (as stated by a source; not independently confirmed) / inferred / conflicting / unknown | 0 of 2 null |
| `source_url` | text |  |  | 0 of 2 null |
| `checked_at` | date (YYYY-MM-DD) |  | Date actually checked in this pass. Empty when not re-checked. | 0 of 2 null |

## app_store_functions

| field | type | key | description | nulls |
|---|---|---|---|---|
| `app_id` | text | FK | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. | 0 of 4 null |
| `xero_store_function_id` | text |  |  | 0 of 4 null |
| `xero_store_function_name` | text |  |  | 0 of 4 null |
| `kind` | text |  |  | 0 of 4 null |
| `evidence_status` | text |  | verified (confirmed on an authoritative primary source by us on checked_at) / source-reported (as stated by a source; not independently confirmed) / inferred / conflicting / unknown | 0 of 4 null |
| `source_url` | text |  |  | 0 of 4 null |
| `checked_at` | date (YYYY-MM-DD) |  | Date actually checked in this pass. Empty when not re-checked. | 0 of 4 null |

## app_listing_industries

| field | type | key | description | nulls |
|---|---|---|---|---|
| `app_id` | text | FK | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. | 0 of 4 null |
| `xero_industry_id` | text |  |  | 0 of 4 null |
| `xero_industry_name` | text |  |  | 0 of 4 null |
| `evidence_status` | text |  | verified (confirmed on an authoritative primary source by us on checked_at) / source-reported (as stated by a source; not independently confirmed) / inferred / conflicting / unknown | 0 of 4 null |
| `source_url` | text |  |  | 0 of 4 null |
| `checked_at` | date (YYYY-MM-DD) |  | Date actually checked in this pass. Empty when not re-checked. | 0 of 4 null |

## integration_dataflows

| field | type | key | description | nulls |
|---|---|---|---|---|
| `app_id` | text | FK | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. | 0 of 5 null |
| `xero_object` | text |  |  | 0 of 5 null |
| `xero_object_id` | text |  |  | 0 of 5 null |
| `flow_raw` | text |  | Xero listing data-flow direction: in / out / exchange. | 0 of 5 null |
| `flow_meaning` | text |  |  | 0 of 5 null |
| `evidence_status` | text |  | verified (confirmed on an authoritative primary source by us on checked_at) / source-reported (as stated by a source; not independently confirmed) / inferred / conflicting / unknown | 0 of 5 null |
| `source_url` | text |  |  | 0 of 5 null |
| `checked_at` | date (YYYY-MM-DD) |  | Date actually checked in this pass. Empty when not re-checked. | 0 of 5 null |
| `note` | text |  |  | 0 of 5 null |

## app_awards

| field | type | key | description | nulls |
|---|---|---|---|---|
| `award_id` | text | PK |  | 0 of 21 null |
| `app_id` | text | FK | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. | 0 of 21 null |
| `award_program` | text |  |  | 0 of 21 null |
| `award_year` | number |  |  | 1 of 21 null |
| `award_category` | text |  |  | 0 of 21 null |
| `result` | text |  |  | 0 of 21 null |
| `evidence_status` | text |  | verified (confirmed on an authoritative primary source by us on checked_at) / source-reported (as stated by a source; not independently confirmed) / inferred / conflicting / unknown | 0 of 21 null |
| `source_url` | text |  |  | 0 of 21 null |
| `note` | text |  |  | 0 of 21 null |
| `checked_at` | date (YYYY-MM-DD) |  | Date actually checked in this pass. Empty when not re-checked. | 0 of 21 null |

## xero_taxonomy

| field | type | key | description | nulls |
|---|---|---|---|---|
| `kind` | text |  |  | 0 of 70 null |
| `value` | text |  |  | 0 of 70 null |
| `meaning` | text |  |  | 0 of 70 null |
| `source_url` | text |  |  | 0 of 70 null |
| `source_location` | text |  |  | 0 of 70 null |

## xero_research_log

| field | type | key | description | nulls |
|---|---|---|---|---|
| `source_url` | text | PK |  | 0 of 5 null |
| `source` | text |  |  | 0 of 5 null |
| `established` | text |  |  | 0 of 5 null |
| `not_established` | text |  |  | 0 of 5 null |
| `read_on` | date (YYYY-MM-DD) |  |  | 1 of 5 null |

## engine_input_contract

| field | type | key | description | nulls |
|---|---|---|---|---|
| `factor_type` | text |  |  | 0 of 14 null |
| `factor` | text | PK |  | 0 of 14 null |
| `input_table_fields` | text |  |  | 0 of 14 null |
| `proposed_role` | text |  |  | 0 of 14 null |
| `missing_data_rule` | text |  |  | 1 of 14 null |

## App List (original)

| field | type | key | description | nulls |
|---|---|---|---|---|
| `App` | as original |  | Original workbook column, preserved |  |
| `Website` | as original |  | Original workbook column, preserved |  |
| `Xero listing` | as original |  | Original workbook column, preserved |  |
| `Area` | as original |  | Original workbook column, preserved |  |
| `Xero categories` | as original |  | Original workbook column, preserved |  |
| `What it does` | as original |  | Original workbook column, preserved |  |
| `FS line items` | as original |  | Original workbook column, preserved |  |
| `Statements` | as original |  | Original workbook column, preserved |  |
| `No. of line items` | as original |  | Original workbook column, preserved |  |
| `Pricing (as at Nov 2026, ex VAT)` | as original |  | Original workbook column, preserved |  |
| `Industry` | as original |  | Original workbook column, preserved |  |
| `Business size` | as original |  | Original workbook column, preserved |  |
| `Xero rating` | as original |  | Original workbook column, preserved |  |
| `Xero reviews` | as original |  | Original workbook column, preserved |  |
| `Source` | as original |  | Original workbook column, preserved |  |
| `Pricing tiers captured` | as original |  | Original workbook column, preserved |  |
| `app_id (proposed)` | as original |  | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. |  |
| `record_status` | as original |  | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. |  |

## Apps by Line Item (original)

| field | type | key | description | nulls |
|---|---|---|---|---|
| `App` | as original |  | Original workbook column, preserved |  |
| `Website` | as original |  | Original workbook column, preserved |  |
| `Area` | as original |  | Original workbook column, preserved |  |
| `What it does` | as original |  | Original workbook column, preserved |  |
| `FS line item` | as original |  | Original workbook column, preserved |  |
| `Statement` | as original |  | Original workbook column, preserved |  |
| `Pricing (as at Nov 2026, ex VAT)` | as original |  | Original workbook column, preserved |  |
| `Industry` | as original |  | Original workbook column, preserved |  |
| `Business size` | as original |  | Original workbook column, preserved |  |
| `Xero rating` | as original |  | Original workbook column, preserved |  |
| `Xero reviews` | as original |  | Original workbook column, preserved |  |
| `Source` | as original |  | Original workbook column, preserved |  |
| `app_id (proposed)` | as original |  | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. |  |
| `mapping_id` | as original |  | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. |  |

## Pricing Tiers (original)

| field | type | key | description | nulls |
|---|---|---|---|---|
| `App` | as original |  | Original workbook column, preserved |  |
| `Area` | as original |  | Original workbook column, preserved |  |
| `Tier / plan` | as original |  | Original workbook column, preserved |  |
| `Price (ex VAT unless stated)` | as original |  | Original workbook column, preserved |  |
| `Billing basis` | as original |  | Original workbook column, preserved |  |
| `Tier description / limits` | as original |  | Original workbook column, preserved |  |
| `What the tier includes` | as original |  | Original workbook column, preserved |  |
| `Add-ons & extra charges` | as original |  | Original workbook column, preserved |  |
| `Source type` | as original |  | Original workbook column, preserved |  |
| `Source URL` | as original |  | Original workbook column, preserved |  |
| `app_id (proposed)` | as original |  | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. |  |
| `tier_id` | as original |  | Proposed stable app identifier. xa-<Xero listing slug> for listed apps; ext-<slugified name> otherwise. Not yet reconciled with repo IDs. |  |
