# Manifest

| file | role | rows | quarantined | primary key | foreign keys |
|---|---|---|---|---|---|
| `csv/apps.csv` | importable | 728 | 0 | app_id | - |
| `csv/identity_crosswalk.csv` | importable | 729 | 2 | record_id | proposed_app_id -> apps.app_id |
| `csv/fs_mappings.csv` | importable | 1136 | 3 | mapping_id | app_id -> apps.app_id; record_id -> identity_crosswalk.record_id |
| `csv/fs_line_item_crosswalk.csv` | reference | 41 | 0 | statement + fs_line_item_legacy | (statement, fs_line_item_legacy) <- fs_mappings |
| `csv/area_crosswalk.csv` | reference | 27 | 0 | area_legacy | area_legacy <- apps / fs_mappings |
| `csv/pricing_tiers_norm.csv` | importable | 330 | 0 | tier_id | app_id -> apps.app_id |
| `csv/app_regions.csv` | importable | 24 | 0 | app_id + region_code | app_id -> apps.app_id |
| `csv/app_languages.csv` | importable | 2 | 0 | app_id + language_code | app_id -> apps.app_id |
| `csv/app_store_functions.csv` | importable | 4 | 0 | app_id + xero_store_function_id | app_id -> apps.app_id |
| `csv/app_listing_industries.csv` | importable | 4 | 0 | app_id + xero_industry_id | app_id -> apps.app_id |
| `csv/integration_dataflows.csv` | importable | 5 | 0 | app_id + xero_object_id | app_id -> apps.app_id |
| `csv/app_awards.csv` | importable | 21 | 0 | award_id | app_id -> apps.app_id |
| `csv/xero_taxonomy.csv` | reference | 70 | 0 | kind + value | - |
| `csv/xero_research_log.csv` | reference | 5 | 0 | source_url | - |
| `csv/engine_input_contract.csv` | reference | 14 | 0 | factor | - |
| `csv/data_dictionary.csv` | documentation | 219 | 0 | table + field | - |
| `csv/change_log.csv` | documentation | 16 | 0 | - | - |
| `csv/research_backlog.csv` | documentation | 10 | 0 | item | - |
| `csv/unresolved_questions.csv` | documentation | 10 | 0 | question | - |
| `quarantine/identity_crosswalk_quarantined.csv` | quarantine | 2 | | record_id | proposed_app_id (candidate) |
| `quarantine/fs_mappings_quarantined.csv` | quarantine | 3 | | mapping_id | candidate_app_id |
| `identity-crosswalk.csv` | copy of csv/identity_crosswalk.csv | | | record_id | |
| `scripts/fetch_xero_listing_metadata.py` | enrichment script | | | | |

Field names, types and null counts per table are in `manifest.json` and `data-dictionary.md`. Conventions: UTF-8, empty = null, `TRUE`/`FALSE`, ISO dates. Values are literal computed values, not formulas.
