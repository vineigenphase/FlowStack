#!/usr/bin/env bash
# Copies the Neon connection strings from .env.local into Vercel (Preview + Production) and generates fresh
# per-environment secrets. Prints names only, never values. Run from the repo root: bash scripts/vercel-env.sh
set -e
get() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }
DB=$(get DATABASE_URL); DBU=$(get DATABASE_URL_UNPOOLED)
[ -n "$DB" ] && [ -n "$DBU" ] || { echo "Neon URLs missing from .env.local — run neon deploy first"; exit 1; }
rand() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('$2'))"; }
add() { # name env value
  if printf %s "$3" | vercel env add "$1" "$2" --yes --force >/dev/null 2>&1; then echo "  set $1 ($2)"; else echo "  FAILED $1 ($2)"; fi
}
for E in preview production; do
  add DATABASE_URL "$E" "$DB"
  add DATABASE_URL_UNPOOLED "$E" "$DBU"
  add TOKEN_ENC_KEY "$E" "$(rand 32 base64)"   # different per environment; losing it means everyone reconnects
  add SESSION_SECRET "$E" "$(rand 48 base64)"
  add CRON_SECRET "$E" "$(rand 24 hex)"
  add XERO_MODE "$E" fixtures                  # switch to live once the Xero app credentials are added
  add LLM_ENABLED "$E" false
  add ADMIN_EMAILS "$E" "svinujan10@gmail.com"
done
echo "Done. APP_URL is set after the first deploy, once the URL is known."
