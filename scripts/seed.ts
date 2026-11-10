/**
 * pnpm db:seed              → catalogue (sample-labelled) into apps / fingerprints / integrations / app_facts
 * pnpm db:seed --demo-org   → also creates a SAMPLE org and refreshes it from XERO_FIXTURE_SET
 * pnpm db:seed --samples    → also creates the three SAMPLE companies (hospitality, ecommerce, SaaS: v1.1 P)
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
const { seedFacts } = await import("@/lib/catalog/facts");
const facts = await seedFacts();
console.log(`seeded ${apps().length} apps (all sample: true), ${facts} new fact rows (state: missing)`);

if (process.argv.includes("--demo-org")) {
  const { runRefresh } = await import("@/lib/sync/refresh");
  const { FixtureXeroClient } = await import("@/lib/xero/client");
  const set = env().XERO_FIXTURE_SET;
  const [o] = await db.insert(orgs).values({ name: `Demo org from ${set} (sample)`, sample: true }).returning();
  const r = await runRefresh(o!.id, { client: new FixtureXeroClient(set, o!.id), now: new Date("2026-11-04T12:00:00Z") });
  console.log(`demo org ${o!.id} refreshed: ${r.status} (run ${r.runId})`);
}
if (process.argv.includes("--samples")) {
  const { runRefresh } = await import("@/lib/sync/refresh");
  const { FixtureXeroClient } = await import("@/lib/xero/client");
  const samples = [
    { set: "demo-uk-ecommerce", name: "Northwind Goods Ltd (sample)", industry: "ecommerce" },
    { set: "demo-uk-saas", name: "Lumen Analytics Ltd (sample)", industry: "saas" },
    { set: "demo-uk-synthetic", name: "Copperpot Kitchens Ltd (sample)", industry: "hospitality" },
  ];
  for (const x of samples) {
    const [o] = await db.insert(orgs).values({ name: x.name, sample: true, industry: x.industry }).returning();
    const r = await runRefresh(o!.id, { client: new FixtureXeroClient(x.set, o!.id), now: new Date("2026-11-04T12:00:00Z") });
    console.log(`${x.name} ${o!.id} refreshed: ${r.status}`);
  }
}
process.exit(0);
