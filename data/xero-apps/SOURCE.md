# Xero app database: source (ENGINE-V2 Phase 0)

**Built by:** the owner's team (the reviewed workbook and handoff, 17 Nov 2026), plus Claude Code reading the public Xero App
Store listing page of every app in it (18 Nov 2026, owner decision of 18 Nov). Moved here from `docs/app-catalogue-handoff/`
on 22 Nov 2026 (ENGINE-V2 Phase 0). The same handoff was re-sent on 22 Nov (`FlowStack_app-catalogue-handoff_1.zip`); every
file in it is byte-identical to `handoff/`.

| path | what | captured |
|---|---|---|
| `handoff/` | The owner's handoff as delivered: `FlowStack_App_Catalogue_revised.xlsx` (reviewed workbook), the original `Xero_App_Ecosystem_with_Pricing.xlsx`, normalised `csv/`, `quarantine/`, crosswalk, change log, validation report | 17 Nov 2026 |
| `handoff/enrichment_run/fetch_log.csv` | One row per listing page fetched (status, date) | 18 Nov 2026 |
| `handoff/enrichment_run/raw/` | Parsed data from each listing page. **Local only, gitignored** (9 MB; Xero site content, pending the terms check) | 18 Nov 2026 |
| `directory.json` | The database: workbook + listing pages merged, keyed on the reviewed `app_id`. `pnpm catalogue:build` (`scripts/catalogue/build-directory.ts`) | as of 18 Nov 2026 |
| `listings.json` | The same apps in the ENGINE-V2 canonical shape (`lib/appdb/schema.ts`). `pnpm appdb:adapt` (`scripts/appdb/adapt.ts`); report in `docs/appdb-import-report.md` | as of 18 Nov 2026 |

## Where each field comes from

| canonical field | source |
|---|---|
| `listing_id` | Reviewed id from the handoff's identity crosswalk: `xa-<Xero listing slug>` or `ext-<name>` (no Xero listing) |
| `name` | Workbook name, trimmed (5 names had trailing spaces). The listing's own title differs for 2 apps (report notes) |
| `website` | Workbook (vendor site), domain only |
| `xero_categories` | Xero App Store listing page: the categories Xero files the app under ("Payroll HR", "Bills and expenses", …) |
| `xero_functions` | Xero App Store listing page: the data-flow section (Xero objects the app reads/writes: "Invoices", "Manual Journals", …) |
| `description` | Xero listing page short description; the workbook's text for the 14 apps with no readable listing |
| `rating_avg`, `rating_count`, `review_count` | Xero listing page as shown (the workbook's figure, labelled, for the 9 listings that now return 404). Xero shows one count; every review carries stars, so both counts are that number. 0 reviews → rating null |
| `pricing_tiers` | Workbook `pricing_tiers_norm` (vendor pricing pages, each with source URL and date, checked 17 Nov 2026). Prices are not on the Xero listing page. `price_gbp` only when the vendor states £; other currencies stay null, never converted |
| `awards` | Workbook `app_awards`, official Xero records only (Xero's "Award-winning apps" collection). Vendors' own award claims are kept in `directory.json` but not here |
| `markets` | Xero listing page regions (gb/us/ca/au → UK/US/CA/AU) |
| `source_url` | The Xero listing URL, or the vendor site when there is none |
| `captured_at` | Date the listing page was read; the workbook date (17 Nov 2026) for apps with no listing |

Nothing was typed in by hand except the reviewed crosswalk (`catalog/directory-crosswalk.yaml`) and the category and function
maps (`catalog/xero-category-map.yaml`, `catalog/xero-functions.yaml`). Quarantined handoff rows (RemitClear AL-0081, Deel
AL-0557) are never read.

**Terms check pending (NOTES "Waiting on owner"):** descriptions are for keyword matching and the admin dev panel only;
ratings shown only as numbers attributed "Xero App Store, captured <date>"; no review text was collected.
