import { loadEnvFiles } from "./_env";
loadEnvFiles();

const { openDb, migrateDb } = await import("@/lib/db/client");
const { env } = await import("@/lib/env");

const h = await openDb(env().DATABASE_ADMIN_URL || env().DATABASE_URL);
await migrateDb(h);
await h.close();
console.log(`migrated (${h.kind})`);
