/**
 * ENGINE-V2: load data/xero-apps/listings.json into the global table xero_app_listings (migration 0025).
 * Idempotent: upsert keyed on listing_id; rows no longer in the file are removed. The engine itself reads the
 * versioned file (so a deploy never depends on this load); the table is for SQL reporting and the dev panel.
 *
 *   pnpm appdb:load --dry-run                 counts only
 *   pnpm appdb:load                           local database only (PGlite / localhost)
 *   pnpm appdb:load --remote-confirmed        any other database (production needs the owner's approval first)
 * Rollback: DELETE FROM xero_app_listings (nothing else reads or writes it).
 */
import fs from "node:fs";
import { loadEnvFiles } from "../_env";
loadEnvFiles();

const { notInArray, sql } = await import("drizzle-orm");
const { adminDb } = await import("@/lib/db/client");
const { env } = await import("@/lib/env");
const { xeroAppListings } = await import("@/db/schema");
const { XeroAppListing } = await import("@/lib/appdb/schema");

const dry = process.argv.includes("--dry-run");
const remoteOk = process.argv.includes("--remote-confirmed");
const url = env().DATABASE_ADMIN_URL || env().DATABASE_URL;
const local = !url || /^(pglite:|memory:\/\/)/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const target = local ? "a local database" : new URL(url).hostname;
console.log(`target: ${target}${dry ? " (dry run)" : ""}`);
if (!local && !remoteOk && !dry) {
  console.error("Refusing to write to a non-local database without --remote-confirmed. .env.local may point at production.");
  process.exit(1);
}

const file = JSON.parse(fs.readFileSync("data/xero-apps/listings.json", "utf8")) as { listings: unknown[] };
const rows = file.listings.map((l) => XeroAppListing.parse(l));
const db = await adminDb();
const before = (await db.select({ n: sql<number>`count(*)::int` }).from(xeroAppListings))[0]!.n;
if (dry) {
  console.log(`would upsert ${rows.length} listings; table has ${before} now`);
  process.exit(0);
}
await db.transaction(async (tx) => {
  for (const r of rows) {
    await tx
      .insert(xeroAppListings)
      .values({ listingId: r.listing_id, name: r.name, data: r, capturedAt: r.captured_at })
      .onConflictDoUpdate({ target: xeroAppListings.listingId, set: { name: r.name, data: r, capturedAt: r.captured_at, loadedAt: new Date() } });
  }
  await tx.delete(xeroAppListings).where(notInArray(xeroAppListings.listingId, rows.map((r) => r.listing_id)));
});
const after = (await db.select({ n: sql<number>`count(*)::int` }).from(xeroAppListings))[0]!.n;
console.log(`loaded ${rows.length} listings (table: ${before} → ${after})`);
process.exit(0);
