/** Loads the published facts and review scores that priority ranking needs (catalogue tables are global). */
import { and, inArray } from "drizzle-orm";
import { appFacts } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { supportScores } from "@/lib/reviews";
import type { PriorityInput } from "./priority";

const KNOWN = new Set(["verified", "found"]);

export async function priorityInputs(recs: { appId: string; name: string; match: number }[]): Promise<PriorityInput[]> {
  const ids = recs.map((r) => r.appId);
  if (!ids.length) return [];
  const db = await adminDb();
  const facts = await db.select().from(appFacts).where(and(inArray(appFacts.appId, ids), inArray(appFacts.field, ["price_from_gbp", "days_to_go_live"])));
  const num = (appId: string, field: string) => {
    const f = facts.find((x) => x.appId === appId && x.field === field && KNOWN.has(x.state));
    return typeof f?.value === "number" ? f.value : null;
  };
  const support = await supportScores(ids);
  return recs.map((r) => ({ ...r, priceFrom: num(r.appId, "price_from_gbp"), daysToLive: num(r.appId, "days_to_go_live"), support: support.get(r.appId) ?? null }));
}
