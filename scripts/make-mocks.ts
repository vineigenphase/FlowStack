/**
 * Writes mocks/ for front-end mock mode (UI-SPEC §3). Every file is the REAL contract output (lib/api/contract.ts)
 * for the labelled sample companies, run on an in-memory database from the Xero fixtures, so the mocks can't drift
 * from the API. Scenarios (?scenario=) are applied when serving (lib/api/mock.ts), not stored.
 *
 *   pnpm mocks        (= tsx scripts/make-mocks.ts)
 *
 * No real customer data: fixtures only, every org is `sample: true`.
 */
import fs from "node:fs";
import path from "node:path";
import { freshDb } from "../tests/helpers/db";
import { adminDb } from "@/lib/db/client";
import { orgMembers, orgs, users } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { seedFacts } from "@/lib/catalog/facts";
import * as C from "@/lib/api/contract";

const OUT = path.resolve(process.cwd(), "mocks");
const MOCK_USER = "00000000-0000-4000-8000-0000000000a1";
const ORGS = [
  { id: "00000000-0000-4000-8000-00000000a001", set: "demo-uk-ecommerce", name: "Northwind Goods Ltd (sample)", industry: "ecommerce" },
  { id: "00000000-0000-4000-8000-00000000a002", set: "demo-uk-saas", name: "Lumen Analytics Ltd (sample)", industry: "saas" },
  { id: "00000000-0000-4000-8000-00000000a003", set: "demo-uk-synthetic", name: "Copperpot Kitchens Ltd (sample)", industry: "hospitality" },
  { id: "00000000-0000-4000-8000-00000000a004", set: "demo-uk-ecommerce", name: "Harbour Supply Co (sample)", industry: "ecommerce" },
  { id: "00000000-0000-4000-8000-00000000a005", set: "demo-uk-saas", name: "Brightline Software Ltd (sample)", industry: "saas" },
];
const DEFAULT = ORGS[0]!.id;

function write(rel: string, data: unknown) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
}

async function main() {
  await freshDb();
  await seedFacts();
  const db = await adminDb();
  await db.insert(users).values({ id: MOCK_USER, email: "finance.lead@example.test", name: "Sam Finance (sample)", jobTitle: "financial_controller" });
  const runs = new Map<string, string>();
  for (const o of ORGS) {
    await db.insert(orgs).values({ id: o.id, name: o.name, sample: true, industry: o.industry, markets: ["UK"] });
    await db.insert(orgMembers).values({ orgId: o.id, userId: MOCK_USER, role: "owner" });
    const r = await runRefresh(o.id, { client: new FixtureXeroClient(o.set, o.id), now: new Date("2026-11-04T10:00:00Z") });
    runs.set(o.id, r.runId);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  const meAll = (await C.me(MOCK_USER, DEFAULT))!;
  write("me-accountant.json", meAll);
  write("me.json", { ...meAll, orgs: meAll.orgs.filter((o) => o.id === DEFAULT) });

  // Two shortlisted apps, so the drawer has something in it.
  const sum0 = (await C.summary(DEFAULT))!;
  for (const l of sum0.biggestLines.slice(0, 2)) if (l.topApp) await C.addToShortlist(DEFAULT, MOCK_USER, l.topApp.id, l.key);

  write("summary.json", await C.summary(DEFAULT));
  write("settings.json", await C.settingsOf(DEFAULT));
  write("refresh-run.json", await C.refreshRun(DEFAULT, runs.get(DEFAULT)!));
  const keys = new Set<string>();
  for (const kind of ["pl", "bs", "cf"] as const) {
    const s = (await C.statement(DEFAULT, kind))!;
    write(`statements/${kind}.json`, s);
    for (const sec of s.sections) for (const l of sec.lines) if (l.flagId) keys.add(l.key);
    if (kind !== "cf") write(`statements/${kind}-12.json`, await C.statement(DEFAULT, kind, { months: 12 }));
  }
  for (const t of sum0.trends) if (t.lineKey) keys.add(t.lineKey);
  for (const k of keys) {
    const d = await C.lineDetail(DEFAULT, k);
    if (d) write(`lines/${encodeURIComponent(k)}.json`, d);
  }
  write("detected-apps.json", await C.detectedAppsView(DEFAULT));
  write("essentials.json", await C.essentialsOf(DEFAULT));
  write("shortlist.json", await C.shortlistOf(DEFAULT));
  const cards = await C.appCards({});
  write("apps.json", cards);
  for (const c of cards) write(`apps/${c.id}.json`, await C.dossier(c.id, DEFAULT));
  write("plans.json", C.plansView());
  write("subscription.json", await C.subscriptionOf(DEFAULT));
  write("index.json", { generatedFrom: "fixtures/xero (sample companies only)", defaultOrg: DEFAULT, orgs: ORGS.map(({ id, name }) => ({ id, name })), lines: [...keys].sort() });
  console.log(`mocks written: ${keys.size} lines, ${cards.length} apps → ${path.relative(process.cwd(), OUT)}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
