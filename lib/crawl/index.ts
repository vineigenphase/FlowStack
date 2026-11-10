/**
 * Monthly catalogue crawl (BACKEND.md §11). Vendor pages → extracted facts → quote check → fact states.
 * Never auto-promotes to "verified"; people do that from the review queue.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { appFacts, crawlPages } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { apps as catalogApps } from "@/lib/catalog/load";
import { FACT_FIELDS, seedFacts, type FactField } from "@/lib/catalog/facts";
import { enqueueAll, stableJson, type QueueItem } from "@/lib/queue/enqueue";
import { makeFetcher, type PageFetcher } from "./fetch";
import { llmExtractor, rulesExtractor, type Extracted, type Extractor, type Page } from "./extract";
import { quoteFound } from "./quote-check";

/** v1.1 L: up to 7 pages per vendor (BACKEND §11). */
const PAGE_KINDS = ["home", "services", "pricing", "product", "integrations", "security", "terms"] as const;
export const SPOT_CHECK_SHARE = 0.2;
export const STALE_DAYS = 90;
const MOVE_LIMIT = 0.3;

export type CrawlDeps = { fetchPage?: PageFetcher; extractors?: Extractor[]; now?: Date; random?: () => number };
export type CrawlSummary = {
  appId: string;
  pages: Record<string, string>;
  skipped: boolean;
  found: string[];
  missing: string[];
  conflicting: string[];
  rejectedQuotes: number;
  queued: number;
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** >30% move on a number counts as a conflict worth a person's look. */
function movedTooFar(prev: unknown, next: unknown) {
  return typeof prev === "number" && typeof next === "number" && prev > 0 && Math.abs(next - prev) / prev > MOVE_LIMIT;
}

export async function crawlApp(appId: string, deps: CrawlDeps = {}): Promise<CrawlSummary> {
  const app = catalogApps().find((a) => a.id === appId);
  if (!app) throw new Error(`Unknown app ${appId}`);
  const now = deps.now ?? new Date();
  const random = deps.random ?? Math.random;
  const fetchPage = deps.fetchPage ?? makeFetcher();
  const llm = deps.extractors ? null : await llmExtractor();
  const extractors = deps.extractors ?? [rulesExtractor, ...(llm ? [llm] : [])];
  const db = await adminDb();
  await seedFacts(); // make sure every field has a row to update

  const summary: CrawlSummary = { appId, pages: {}, skipped: false, found: [], missing: [], conflicting: [], rejectedQuotes: 0, queued: 0 };
  if (!app.website || !app.crawl) {
    summary.skipped = true;
    return summary;
  }

  // 1–2. Fetch pages, store text + hash.
  const pages: Page[] = [];
  let changed = false;
  for (const kind of PAGE_KINDS) {
    const p = app.crawl[kind];
    if (p === null || p === undefined) continue;
    const url = new URL(p, app.website).toString();
    const res = await fetchPage(url);
    summary.pages[kind] = res.status;
    const [prev] = await db.select().from(crawlPages).where(and(eq(crawlPages.appId, appId), eq(crawlPages.kind, kind)));
    const textHash = res.text ? hash(res.text) : null;
    if (res.status === "ok" && textHash !== prev?.textHash) changed = true;
    const row = { appId, kind, url, fetchedAt: now, status: res.status, textHash, text: res.text };
    await db.insert(crawlPages).values(row).onConflictDoUpdate({ target: [crawlPages.appId, crawlPages.kind], set: row });
    if (res.status === "ok" && res.text) pages.push({ kind, url, text: res.text });
  }

  const current = new Map((await db.select().from(appFacts).where(eq(appFacts.appId, appId))).map((f) => [f.field, f]));
  const pending: QueueItem[] = [];

  // Nothing fetched: we learned nothing. Don't touch facts (and never "confirm" them from pages we couldn't read).
  if (!pages.length) {
    summary.skipped = true;
    return summary;
  }

  // Unchanged pages: no extraction; the page still says what it said, so the facts stay fresh.
  if (!changed) {
    summary.skipped = true;
    await db
      .update(appFacts)
      .set({ checkedAt: now })
      .where(and(eq(appFacts.appId, appId), inArray(appFacts.state, ["found", "verified"])));
    return summary;
  }

  // 3–4. Extract, then keep only facts whose quote is on the page it came from.
  const byField = new Map<FactField, { value: unknown; quote: string; url: string }[]>();
  for (const page of pages) {
    const got: Extracted[] = (await Promise.all(extractors.map((x) => x(page)))).flat();
    for (const f of got) {
      if (!quoteFound(f.quote, page.text)) {
        summary.rejectedQuotes++;
        continue;
      }
      byField.set(f.field, [...(byField.get(f.field) ?? []), { value: f.value, quote: f.quote, url: page.url }]);
    }
  }

  // 5. Compare with what we hold.
  for (const field of FACT_FIELDS) {
    const prev = current.get(field);
    const cands = byField.get(field) ?? [];
    const distinct = [...new Map(cands.map((c) => [stableJson(c.value), c])).values()];

    if (!distinct.length) {
      if (prev?.state === "verified") continue; // a person confirmed it; the site just doesn't say it
      summary.missing.push(field);
      await db
        .update(appFacts)
        .set({ value: null, state: "missing", quote: null, sourceUrl: null, checkedAt: now, checkedBy: "crawler", sample: false })
        .where(and(eq(appFacts.appId, appId), eq(appFacts.field, field)));
      continue;
    }

    const conflict = distinct.length > 1 || (prev?.value !== null && prev?.value !== undefined && movedTooFar(prev.value, distinct[0]!.value));
    if (conflict) {
      summary.conflicting.push(field);
      // Keep the last value we had; a person decides.
      await db.update(appFacts).set({ state: "conflicting", checkedAt: now, checkedBy: "crawler" }).where(and(eq(appFacts.appId, appId), eq(appFacts.field, field)));
      pending.push({
        kind: "fact_conflicting",
        orgId: null,
        ref: { app_id: appId, field, values: distinct.map((d) => d.value) },
        reason: `${app.name}: ${field} — ${distinct.map((d) => `${JSON.stringify(d.value)} (${d.url})`).join(" vs ")}${prev?.value != null ? `; we had ${JSON.stringify(prev.value)}` : ""}`,
      });
      continue;
    }

    const c = distinct[0]!;
    const same = prev?.value != null && stableJson(prev.value) === stableJson(c.value);
    if (same && prev?.state === "verified") {
      await db.update(appFacts).set({ checkedAt: now }).where(and(eq(appFacts.appId, appId), eq(appFacts.field, field)));
      continue;
    }
    summary.found.push(field);
    await db
      .update(appFacts)
      .set({ value: c.value, state: "found", quote: c.quote, sourceUrl: c.url, checkedAt: now, checkedBy: "crawler", sample: false })
      .where(and(eq(appFacts.appId, appId), eq(appFacts.field, field)));
    if (!same && random() < SPOT_CHECK_SHARE) {
      pending.push({
        kind: "fact_spot_check",
        orgId: null,
        ref: { app_id: appId, field, value: c.value },
        reason: `${app.name}: spot-check ${field} = ${JSON.stringify(c.value)} — "${c.quote}" (${c.url})`,
      });
    }
  }

  if (summary.missing.length) {
    pending.push({
      kind: "fact_missing",
      orgId: null,
      ref: { app_id: appId, fields: [...summary.missing].sort() },
      reason: `${app.name}: not published on the vendor's site — ${summary.missing.join(", ")}`,
    });
  }
  summary.queued = await enqueueAll(pending);
  return summary;
}

export async function crawlAll(deps: CrawlDeps = {}) {
  const out: CrawlSummary[] = [];
  for (const a of catalogApps()) if (a.crawl && a.website) out.push(await crawlApp(a.id, deps));
  return out;
}

/** 6. Nightly: facts not confirmed for 90 days → stale + queue. */
export async function markStale(now = new Date()) {
  const db = await adminDb();
  const cutoff = new Date(now.getTime() - STALE_DAYS * 86_400_000);
  const rows = await db
    .update(appFacts)
    .set({ state: "stale" })
    .where(and(inArray(appFacts.state, ["found", "verified"]), lt(appFacts.checkedAt, cutoff)))
    .returning();
  await enqueueAll(
    rows.map((r) => ({
      kind: "fact_stale" as const,
      orgId: null,
      ref: { app_id: r.appId, field: r.field, checked_at: r.checkedAt?.toISOString().slice(0, 10) },
      reason: `${r.appId}: ${r.field} not confirmed since ${r.checkedAt?.toISOString().slice(0, 10)}`,
    })),
  );
  return rows.length;
}
