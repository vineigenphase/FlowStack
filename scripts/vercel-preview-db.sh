#!/usr/bin/env bash
# Points Vercel's Preview environment at the Neon `preview` branch (Production keeps the `production` branch).
# Fetches the connection strings with the Neon CLI and pipes them straight into Vercel; prints names only, never values.
# Run from the repo root: bash scripts/vercel-preview-db.sh
set -e
PROJECT=round-mouse-47017658
POOLED=$(neon connection-string preview --project-id "$PROJECT" --pooled 2>/dev/null)
DIRECT=$(neon connection-string preview --project-id "$PROJECT" 2>/dev/null)
case "$POOLED" in *-pooler.*) ;; *) echo "Couldn't get the pooled preview URL — run: neon login"; exit 1 ;; esac
case "$DIRECT" in *-pooler.*|"") echo "Couldn't get the direct preview URL — run: neon login"; exit 1 ;; esac
add() { # name value
  if printf %s "$2" | vercel env add "$1" --environment preview --yes --force >/dev/null 2>&1; then echo "  set $1 (preview)"; else echo "  FAILED $1 (preview)"; fi
}
add DATABASE_URL "$POOLED"
add DATABASE_URL_UNPOOLED "$DIRECT"
add NEON_BRANCH preview
echo "Done. Preview deploys now migrate and run against the Neon 'preview' branch."
