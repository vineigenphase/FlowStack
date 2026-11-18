# Suggested additions to the FlowStack repo's CLAUDE.md

Merge these into the existing `CLAUDE.md`. Do not overwrite it. If a line conflicts with an existing rule, keep the existing rule and raise the conflict with the owner.

```markdown
## App catalogue data (docs/app-catalogue-handoff/)
- Xero access is read-only. Never write to a Xero organisation.
- App identity = app_id from the reviewed identity crosswalk. Never join catalogue tables on app name; names collide (Employment Hero x2) and have whitespace variants.
- Rows in docs/app-catalogue-handoff/quarantine/ are unresolved. Do not import them as confirmed.
- Unknown is not zero and not false: blank price amount = unknown/quote; null currency is never inferred from "$"; missing rating is not a low rating; missing region/language data is "unresolved", not "incompatible".
- Keep four things separate: official Xero taxonomy (account class/type/report section), tenant account names (from a read-only export only), Xero App Store categories, FlowStack layers (general_pl, further_categorisation).
- Never show a heuristic-from-app-store-category mapping as verified. Upgrade mapping_status only with a cited source and mapping_checked_at.
- Raw xero_rating / xero_reviews are never modified. Derived scores live in separate fields.
- "recc" means "recommended" (owner confirmed). Do not change stored status values, enums or API contracts without approval.
- Schema changes: reversible migrations that keep legacy columns (area_legacy, fs_line_item_legacy). No in-place renames.
- Production migrations, imports and deploys need separate explicit approval.
```
