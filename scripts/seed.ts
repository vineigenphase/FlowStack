/**
 * pnpm db:seed              → catalogue (sample-labelled) into apps / fingerprints / integrations / app_facts
 * pnpm db:seed --demo-org   → also creates a SAMPLE org and refreshes it from XERO_FIXTURE_SET
 */
import { loadEnvFiles } from "./_env";
loadEnvFiles();

const { adminDb } = await import("@/lib/db/client");
const { apps: appsT, fingerprints, integrations, orgs } = await import("@/db/schema");
const { apps, validateCatalog } = await import("@/lib/catalog/load");
const { env } = await import("@/lib/env");

const errs = validateCatalog();
if (errs.length) {
  console.error("catalogue invalid:\n" + errs.join("\n"));
  process.exit(1);
}
const db = await adminDb();
for (const a of apps()) {
  const row = { id: a.id, name: a.name, website: a.website ?? null, categories: a.categories, markets: a.markets, crawl: a.crawl ?? null, sample: a.sample, updatedAt: new Date() };
  await db.insert(appsT).values(row).onConflictDoUpdate({ target: appsT.id, set: row });
  for (const p of a.fingerprints) await db.insert(fingerprints).values({ appId: a.id, pattern: p, kind: p.endsWith(" *") ? "alias" : "name" }).onConflictDoNothing();
  for (const i of a.integrations) await db.insert(integrations).values({ fromApp: a.id, toApp: i.to, kind: i.kind }).onConflictDoNothing();
}
console.log(`seeded ${apps().length} apps (all sample: true)`);

if (process.argv.includes("--demo-org")) {
  const { runRefresh } = await import("@/lib/sync/refresh");
  const { FixtureXeroClient } = await import("@/lib/xero/client");
  const set = env().XERO_FIXTURE_SET;
  const [o] = await db.insert(orgs).values({ name: `Demo org from ${set} (sample)`, sample: true }).returning();
  const r = await runRefresh(o!.id, { client: new FixtureXeroClient(set, o!.id), now: new Date("2026-11-04T12:00:00Z") });
  console.log(`demo org ${o!.id} refreshed: ${r.status} (run ${r.runId})`);
}
process.exit(0);
