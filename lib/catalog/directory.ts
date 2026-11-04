/** Directory read models (BACKEND.md §13: /api/apps). Facts carry state, source, date and the sample flag. */
import { eq } from "drizzle-orm";
import { appFacts } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { appCategories, apps as catalogApps } from "./load";
import { displayFact, FACT_FIELDS, type FactRow } from "./facts";

const DIRECTORY_EXCLUDE = new Set(["accounting", "other_software"]);

async function factsFor(appId?: string) {
  const db = await adminDb();
  const rows = appId ? await db.select().from(appFacts).where(eq(appFacts.appId, appId)) : await db.select().from(appFacts);
  const by = new Map<string, Map<string, FactRow>>();
  for (const r of rows) {
    const m = by.get(r.appId) ?? new Map<string, FactRow>();
    m.set(r.field, { field: r.field, value: r.value, state: r.state, quote: r.quote, sourceUrl: r.sourceUrl, checkedAt: r.checkedAt, sample: r.sample });
    by.set(r.appId, m);
  }
  return by;
}

export async function listApps(filter: { category?: string; market?: string } = {}) {
  const facts = await factsFor();
  const cats = new Map(appCategories().map((c) => [c.key, c.label]));
  return catalogApps()
    .filter((a) => !a.categories.some((c) => DIRECTORY_EXCLUDE.has(c)))
    .filter((a) => !filter.category || a.categories.includes(filter.category))
    .filter((a) => !filter.market || a.markets.includes(filter.market as never))
    .map((a) => {
      const f = facts.get(a.id);
      const price = displayFact(f?.get("price_from_gbp"), "price_from_gbp");
      const known = FACT_FIELDS.filter((k) => {
        const s = f?.get(k)?.state;
        return s === "verified" || s === "found";
      }).length;
      return {
        id: a.id,
        name: a.name,
        website: a.website ?? null,
        categories: a.categories.map((c) => ({ key: c, label: cats.get(c) ?? c })),
        markets: a.markets,
        priceFrom: price,
        factsKnown: known,
        factsTotal: FACT_FIELDS.length,
        sample: a.sample,
      };
    });
}

export async function getApp(id: string) {
  const a = catalogApps().find((x) => x.id === id);
  if (!a) return null;
  const f = (await factsFor(id)).get(id);
  const byId = new Map(catalogApps().map((x) => [x.id, x.name]));
  return {
    id: a.id,
    name: a.name,
    website: a.website ?? null,
    categories: a.categories,
    markets: a.markets,
    integrations: a.integrations.map((i) => ({ to: i.to, name: byId.get(i.to) ?? i.to, kind: i.kind })),
    facts: FACT_FIELDS.map((field) => displayFact(f?.get(field), field)),
    sample: a.sample,
    source: a.source ?? null,
  };
}
