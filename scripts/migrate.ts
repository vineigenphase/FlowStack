import { loadEnvFiles } from "./_env";
loadEnvFiles();

const { openDb, migrateDb } = await import("@/lib/db/client");
const { env } = await import("@/lib/env");

// On Vercel, migrate through the direct (unpooled) connection when one is provided.
const url = env().DATABASE_ADMIN_URL || process.env.DATABASE_URL_UNPOOLED || env().DATABASE_URL;
if (process.env.VERCEL && !url) {
  console.error("DATABASE_URL is not set for this Vercel environment — add the Neon connection string.");
  process.exit(1);
}
const h = await openDb(url);
await migrateDb(h);
await h.close();
console.log(`migrated (${h.kind})`);
