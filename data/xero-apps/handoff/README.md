# FlowStack app-catalogue handoff (17 Nov 2026)

This handoff carries out **Prompt 1** of the FlowStack workbook brief. It is a proposed data contract, not a claim that it matches the repository, which has not been seen.

## What's here

| Item | What it is |
|---|---|
| `FlowStack_App_Catalogue_revised.xlsx` | Revised workbook. Original 5 sheets are preserved, plus 19 new sheets (normalised tables, crosswalks, Xero taxonomy, data dictionary, change log, backlog, questions). |
| `csv/` | One UTF-8 CSV per table: ready-to-import rows only, with literal values and no formulas. |
| `quarantine/` | Rows whose identity is unresolved (2 records, 3 mappings). |
| `identity-crosswalk.csv` | Every source record mapped to a proposed `app_id`. |
| `manifest.json` / `MANIFEST.md` | Files, row counts, keys, field types and conventions. |
| `data-dictionary.md` | Every field, its type, key role, meaning and null count. |
| `change-log.md` | Everything changed, and the fact that nothing was merged or renamed in place. |
| `unresolved-questions.md` | Owner decisions, mappings to review, research backlog, and the stress-test note. |
| `validation-report.md` | Counts, foreign-key checks, ranges, pricing edge cases, formula check and sheet previews. |
| `scripts/fetch_xero_listing_metadata.py` | Read-only script that collects countries, languages, listed date, functions, industries and Xero data flows for all listings. |
| `CLAUDE-CODE-PROMPT.md` | Prompt 2, filled in for this folder and ready to paste into Claude Code. |
| `CLAUDE-md-additions.md` | Rules to merge into the repo's `CLAUDE.md`. |

## Headline numbers

- 730 source records → **728 proposed app IDs ready**, 2 quarantined (RemitClear AL-0081, Deel AL-0557: probable second records of listed apps, not merged). Employment Hero stays as 2 distinct products (different Xero listings).
- 1,139 financial mappings: 1,136 ready, 3 quarantined. 1,036 are `heuristic-from-app-store-category` and 103 are `source-reported`. None are `verified`.
- 330 pricing tiers, all linked by ID. The MMC Excel Converter tier is now counted (the old name join missed it because of a trailing space). 61 tiers have edge-case flags.
- Xero taxonomy: 70 cited rows from Xero's own API specs.
- Awards: 15 official 2025 Xero Global App Award winners, plus 6 vendor claims kept separate.
- Validation: 29 of 29 checks pass, 0 formula errors (1,497 formulas).

## What is NOT done (explicitly)

- **Listing metadata:** only 2 of 723 listings have been read (Claude in Chrome dropped mid-run). The script collects the rest.
- **Vendor pricing:** 545 App List rows are still unchecked against vendor sites.
- **Tenant account names:** these need a read-only chart-of-accounts export from a real organisation. Public sources cannot supply them.
- **Approvals:** no crosswalk, rename, merge or engine weight has been approved. Everything is labelled as a proposal.

## Claude Code readiness checklist

- [ ] Unzip into the repo at `docs/app-catalogue-handoff/` (or edit the path in `CLAUDE-CODE-PROMPT.md`).
- [ ] Keep the original `Xero_App_Ecosystem_with_Pricing.xlsx` alongside, unchanged.
- [ ] Check that no credentials or private Xero exports are in the folder.
- [ ] Merge `CLAUDE-md-additions.md` into the repo `CLAUDE.md`. Keep existing rules and note conflicts.
- [ ] Paste `CLAUDE-CODE-PROMPT.md` into Claude Code. Review its Phase A plan before approving anything.
- [ ] Answer the owner questions in `unresolved-questions.md` (identity, renames, non-P&L branch, `recc` naming, weights, stress-test detail).
- [ ] Attach Luke's artifact when you reach the UI step.
