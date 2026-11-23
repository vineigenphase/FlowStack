import { loadEnvFiles } from "./_env";
loadEnvFiles();

const { openDb, migrateDb } = await import("@/lib/db/client");
const { env } = await import("@/lib/env");

// On Vercel, migrate through the direct (unpooled) connection when one is provided.
// A local PGlite/memory DATABASE_URL always wins: .env.local carries the PRODUCTION unpooled URL, and on 23 Nov 2026
// `DATABASE_URL=pglite:<tmp> tsx scripts/migrate.ts` migrated production through it instead of the throwaway db.
const local = /^(pglite:|memory:\/\/)/.test(process.env.DATABASE_URL ?? "");
const url = local ? env().DATABASE_URL : env().DATABASE_ADMIN_URL || process.env.DATABASE_URL_UNPOOLED || env().DATABASE_URL;
console.log(`migrating ${local ? "a local database" : "the database at " + (url ? new URL(url).hostname : "(PGlite default)")}`);
if (process.env.VERCEL && !url) {
  console.error("DATABASE_URL is not set for this Vercel environment — add the Neon connection string.");
  process.exit(1);
}
const h = await openDb(url);
await migrateDb(h);
await h.close();
console.log(`migrated (${h.kind})`);
