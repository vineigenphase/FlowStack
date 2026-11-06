/** M8: catalogue facts + crawl. Pages are mocked — tests never hit vendor sites. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { appFacts, crawlPages, reviewQueue } from "@/db/schema";
import { crawlApp, markStale } from "@/lib/crawl";
import { robotsAllows } from "@/lib/crawl/fetch";
import { quoteFound } from "@/lib/crawl/quote-check";
import { rulesExtractor, type Extractor } from "@/lib/crawl/extract";
import { getApp, listApps } from "@/lib/catalog/directory";
import { listQueue, resolveItem } from "@/lib/queue/resolve";

const PAGES: Record<string, string> = {
  "https://www.staffology.co.uk/": "Payroll software for UK bureaus. We are ISO 27001 certified and your data is stored in the UK.",
  "https://www.staffology.co.uk/pricing":
    "Simple pricing. From £5 per employee per month. No setup fees. Cancel anytime. Support available 9am - 5pm Monday to Friday.",
  "https://www.staffology.co.uk/payroll": "Auto-enrolment, RTI and journals posted straight to Xero.",
  "https://dext.com/": "Capture receipts and bills in seconds.",
  "https://dext.com/pricing": "Plans to suit every business. Talk to us.",
  "https://www.pleo.io/en": "Smart company cards. Plans from £39 per month.",
  "https://www.pleo.io/en/pricing": "Essential: £49 per month for up to 3 users.",
};

const fetchPage = async (url: string) => (url in PAGES ? { status: "ok" as const, text: PAGES[url]! } : { status: "error" as const, text: null, error: "404" });
/** An extractor that makes things up — none of its facts may survive the quote check. */
const liar: Extractor = async () => [
  { field: "days_to_go_live", value: 3, quote: "live in 3 days" },
  { field: "auto_renew", value: false, quote: "never auto-renews" },
];
const deps = { fetchPage, extractors: [rulesExtractor, liar], now: new Date("2026-11-04T12:00:00Z"), random: () => 0 };

let close: () => Promise<void>;
beforeAll(async () => {
  const h = await freshDb();
  close = h.close;
});
afterAll(() => close());

const fact = async (appId: string, field: string) => {
  const db = await adminDb();
  return (await db.select().from(appFacts).where(and(eq(appFacts.appId, appId), eq(appFacts.field, field))))[0]!;
};

describe("quote check", () => {
  it("folds case, whitespace and typographic punctuation, nothing more", () => {
    expect(quoteFound("from £5 per  employee", "Simple. From £5 per\nemployee per month")).toBe(true);
    expect(quoteFound("don't", "Don’t worry")).toBe(true);
    expect(quoteFound("from £6 per employee", "From £5 per employee")).toBe(false);
    expect(quoteFound("", "anything")).toBe(false);
  });
});

describe("robots.txt", () => {
  const robots = "User-agent: *\nDisallow: /pricing\nAllow: /pricing/public\n\nUser-agent: FlowStackBot\nDisallow: /private";
  it("uses our agent's group when present, longest rule wins", () => {
    expect(robotsAllows(robots, "/private/x")).toBe(false);
    expect(robotsAllows(robots, "/pricing")).toBe(true); // our group doesn't disallow it
    expect(robotsAllows("User-agent: *\nDisallow: /pricing\nAllow: /pricing/public", "/pricing")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /pricing\nAllow: /pricing/public", "/pricing/public/uk")).toBe(true);
    expect(robotsAllows("", "/")).toBe(true);
  });
});

describe("crawl on 3 apps", () => {
  it("staffology: found facts with quotes from the page they came from", async () => {
    const s = await crawlApp("staffology", deps);
    expect(s.found.sort()).toEqual(["data_location", "min_term", "price_from_gbp", "price_model", "security_certs", "setup_fee", "support_hours"]);
    expect(s.rejectedQuotes).toBe(6); // the liar, on each of 3 pages
    const price = await fact("staffology", "price_from_gbp");
    expect(price).toMatchObject({ value: 5, state: "found", sourceUrl: "https://www.staffology.co.uk/pricing", sample: false });
    expect(PAGES[price.sourceUrl!]!).toContain(price.quote!);
    expect((await fact("staffology", "price_model")).value).toBe("per_employee");
    expect((await fact("staffology", "data_location")).value).toBe("UK");
  });

  it("dext: nothing published → missing facts and one fact_missing queue item", async () => {
    const s = await crawlApp("dext", deps);
    expect(s.found).toEqual([]);
    expect(s.missing).toHaveLength(14);
    const q = await listQueue({ kind: "fact_missing" });
    expect(q.map((i) => i.reason).join()).toContain("Dext Prepare: not published");
  });

  it("pleo: two pages disagree → conflicting + queue item, no value guessed", async () => {
    const s = await crawlApp("pleo", deps);
    expect(s.conflicting).toContain("price_from_gbp");
    const f = await fact("pleo", "price_from_gbp");
    expect(f.state).toBe("conflicting");
    expect(f.value).toBeNull();
    const q = await listQueue({ kind: "fact_conflicting" });
    expect(q[0]!.reason).toMatch(/39.*vs.*49/);
  });

  it("no stored fact lacks a matching quote, and nothing is auto-verified", async () => {
    const db = await adminDb();
    const rows = await db.select().from(appFacts);
    const pages = await db.select().from(crawlPages);
    for (const r of rows.filter((x) => x.state === "found")) {
      const page = pages.find((p) => p.url === r.sourceUrl)!;
      expect(quoteFound(r.quote, page.text!), `${r.appId}.${r.field}`).toBe(true);
    }
    expect(rows.some((r) => r.state === "verified")).toBe(false);
    expect(rows.some((r) => r.field === "days_to_go_live" && r.value !== null)).toBe(false);
  });

  it("samples 20% of changed found facts for a spot check (random() = 0 here → all)", async () => {
    const q = await listQueue({ kind: "fact_spot_check" });
    // 7 from Staffology + Pleo's price_model: both pages agree it's a flat monthly price, even though the amounts differ.
    expect(q.length).toBe(8);
  });

  it("an unchanged page skips extraction; a >30% price move is a conflict", async () => {
    const again = await crawlApp("staffology", deps);
    expect(again.skipped).toBe(true);
    PAGES["https://www.staffology.co.uk/pricing"] = PAGES["https://www.staffology.co.uk/pricing"]!.replace("£5 per", "£8 per");
    const moved = await crawlApp("staffology", deps);
    expect(moved.conflicting).toContain("price_from_gbp");
    expect((await fact("staffology", "price_from_gbp")).value).toBe(5); // last value kept for a person to decide
  });
});

describe("unreachable pages", () => {
  it("a crawl where every page fails changes nothing — facts are not re-confirmed", async () => {
    const before = await fact("staffology", "data_location");
    const s = await crawlApp("staffology", { ...deps, fetchPage: async () => ({ status: "error" as const, text: null }), now: new Date("2026-12-01T00:00:00Z") });
    expect(s.skipped).toBe(true);
    expect((await fact("staffology", "data_location")).checkedAt).toEqual(before.checkedAt);
  });
});

describe("people verify; time makes facts stale", () => {
  it("verify from the queue → state verified, by the person, with a source", async () => {
    const item = (await listQueue({ kind: "fact_conflicting" })).find((i) => (i.ref as { app_id: string }).app_id === "pleo")!;
    await resolveItem(item.id, "svinujan10@gmail.com", { action: "verify", field: "price_from_gbp", value: 39, source_url: "https://www.pleo.io/en/pricing" });
    expect(await fact("pleo", "price_from_gbp")).toMatchObject({ state: "verified", value: 39, checkedBy: "svinujan10@gmail.com", sample: false });
  });

  it("facts not confirmed in 90 days go stale and open fact_stale", async () => {
    const n = await markStale(new Date("2027-03-01T00:00:00Z"));
    expect(n).toBeGreaterThan(0);
    expect((await fact("pleo", "price_from_gbp")).state).toBe("stale");
    const db = await adminDb();
    expect((await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "fact_stale"))).length).toBe(n);
  });
});

describe("directory API models", () => {
  it('a missing fact is shown as missing — "Not published · we\'re checking" — never estimated', async () => {
    const dext = (await getApp("dext"))!;
    const price = dext.facts.find((f) => f.field === "price_from_gbp")!;
    expect(price).toMatchObject({ state: "missing", value: null, display: "Not published · we're checking" });
    const brightpay = (await getApp("brightpay"))!; // never crawled: no row → still missing
    expect(brightpay.facts.every((f) => f.state === "missing")).toBe(true);
    expect(brightpay.sample).toBe(true);
  });

  it("lists finance apps only, filterable, with the sample flag carried through", async () => {
    const all = await listApps();
    expect(all.some((a) => a.id === "slack" || a.id === "xero")).toBe(false);
    const payroll = await listApps({ category: "payroll", market: "UK" });
    expect(payroll.map((a) => a.id).sort()).toEqual(["brightpay", "deel", "employmenthero", "staffology", "telleroo"]);
    expect(payroll.every((a) => a.sample)).toBe(true);
  });
});
