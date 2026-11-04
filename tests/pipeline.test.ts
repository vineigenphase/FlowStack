/**
 * End-to-end refresh on fixtures/xero/demo-uk-synthetic (SAMPLE data) against in-memory Postgres.
 * Covers the done-criteria of M3 (statements + cash flow), M4 (apps in use) and M5 (flags + hero £).
 */
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { rowsOf } from "@/lib/db/rows";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { detectedApps, flags, orgs, recommendations, reviewQueue, statements, syncRuns } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { atStake } from "@/lib/signals/compute";
import { accountCategories } from "@/lib/catalog/load";

const expected = JSON.parse(fs.readFileSync("fixtures/xero/demo-uk-synthetic/_expected.json", "utf8"));
const NOW = new Date("2026-11-04T10:00:00Z");

let close: () => Promise<void>;
let orgId: string;
let runId: string;

beforeAll(async () => {
  const h = await freshDb();
  close = h.close;
  const db = await adminDb();
  const [o] = await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true }).returning();
  orgId = o!.id;
  const r = await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: NOW });
  runId = r.runId;
});
afterAll(() => close());

const flagsByKey = async () => {
  const rows = await withOrg(orgId, (tx) => tx.select().from(flags).where(eq(flags.runId, runId)));
  return new Map(rows.map((f) => [f.lineKey, f]));
};

describe("refresh run", () => {
  it("finishes with every step ok and meters calls and bytes", async () => {
    const db = await adminDb();
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(run!.status).toBe("ok");
    expect(run!.steps.every((s) => s.status === "ok")).toBe(true);
    expect(run!.calls).toBeGreaterThanOrEqual(8);
    expect(run!.egressBytes).toBeGreaterThan(10_000);
  });
});

describe("M3 statements", () => {
  it("P&L and BS totals equal Xero's report totals", async () => {
    const rows = await withOrg(orgId, (tx) => tx.select().from(statements).where(eq(statements.runId, runId)));
    const pl = rows.find((s) => s.kind === "pl")!;
    expect(pl.periodFrom).toBe("2026-04-01");
    expect(pl.periodTo).toBe("2026-10-31");
    expect(pl.totals.revenue).toBe(expected.revenue);
    expect(pl.totals.net_profit).toBe(expected.netProfit);
    const bs = rows.filter((s) => s.kind === "bs").sort((a, b) => b.periodTo.localeCompare(a.periodTo));
    expect(bs.map((b) => b.periodTo)).toEqual(["2026-10-31", "2026-03-31"]);
    const t = bs[0]!.totals as Record<string, number>;
    expect(t.total_assets! - t.total_liabilities!).toBeCloseTo(t.total_equity!, 2);
  });

  it("derived cash flow reconciles to the bank movement", async () => {
    const [cf] = await withOrg(orgId, (tx) => tx.select().from(statements).where(and(eq(statements.runId, runId), eq(statements.kind, "cf"))));
    expect(cf!.derived).toBe(true);
    expect(cf!.reconciled).toBe(true);
    expect(cf!.totals).toMatchObject({ cfo: 490_000, cfi: -66_000, cff: -105_000, delta_bank: expected.bankClose - expected.bankOpen, check: 0 });
  });

  it("queues the account it can't map, and its line shows as queued", async () => {
    const db = await adminDb();
    const q = await db.select().from(reviewQueue).where(eq(reviewQueue.kind, "account_mapping"));
    expect(q).toHaveLength(1);
    expect(q[0]!.reason).toContain("Sundry adjustments");
    expect((await flagsByKey()).get("pl:999")!.state).toBe("queued");
  });
});

describe("M4 apps in use", () => {
  it("detects software suppliers from bills and card spend", async () => {
    const rows = await withOrg(orgId, (tx) => tx.select().from(detectedApps));
    const present = rows.filter((r) => r.present).map((r) => r.appId).sort();
    expect(present).toEqual(["deputy", "dext", "google_workspace", "lightspeed", "microsoft_365", "pleo", "slack", "xero"]);
    const pleo = rows.find((r) => r.appId === "pleo")!;
    expect(pleo.spend12m).toBeCloseTo((105.3 / 1.17) * 12, 1); // EUR bills converted to base currency
    expect(pleo.monthsSeen).toBe(12);
  });

  it("queues the fuzzy match and the unknown software supplier instead of guessing", async () => {
    const db = await adminDb();
    const q = await db.select().from(reviewQueue);
    const fuzzy = q.filter((x) => x.kind === "fingerprint_check");
    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0]!.reason).toContain("Fathum");
    const unknown = q.filter((x) => x.kind === "unknown_supplier");
    expect(unknown.map((u) => u.reason).join()).toContain("Tillflow");
    expect(unknown).toHaveLength(1); // Amazon is paid from General Expenses, not a software account
    const rows = await withOrg(orgId, (tx) => tx.select().from(detectedApps));
    expect(rows.find((r) => r.appId === "fathom")).toBeUndefined();
  });
});

describe("M5 flags", () => {
  it("assigns the states worked out by hand", async () => {
    const f = await flagsByKey();
    const state = (k: string) => f.get(k)?.state;
    // Sales flow through Lightspeed, which ranks first → covered.
    expect(state("pl:200")).toBe("covered");
    // Deputy (rota) is in use but Staffology outranks it (native with Deputy) → flagged with gap 0.5.
    expect(state("pl:477")).toBe("flagged");
    expect(f.get("pl:477")!.coverageGap).toBe(0.5);
    for (const k of ["pl:404", "pl:412", "pl:416", "pl:433", "pl:437", "pl:469", "pl:489", "pl:500", "pl:260"]) expect(state(k), k).toBe("fine");
    expect(f.get("pl:477")!.band).toBe("high"); // 690k / 2.566m = 26.9%
    expect(f.get("pl:478")!.band).toBe("medium"); // 71.2k / 2.566m = 2.8%
    expect(f.get("pl:479")!.band).toBe("low"); // 20.7k / 2.566m = 0.8%
  });

  it("hero £ at stake matches the hand calculation", async () => {
    const f = [...(await flagsByKey()).values()];
    // Flagged P&L cost lines: COGS 812,300 + advertising 31,500 + cleaning 18,900 + general 8,700 + utilities 54,300
    // + repairs 27,600 + wages 690,000 + employer NI 71,200 + pensions 20,700 + subscriptions 14,900 + travel 3,800
    const hand = 812_300 + 31_500 + 18_900 + 8_700 + 54_300 + 27_600 + 690_000 + 71_200 + 20_700 + 14_900 + 3_800;
    const flaggedPl = f.filter((x) => x.statementKind === "pl" && x.state === "flagged").map((x) => x.lineKey).sort();
    expect(flaggedPl).toEqual(["pl:310", "pl:400", "pl:408", "pl:429", "pl:445", "pl:473", "pl:477", "pl:478", "pl:479", "pl:485", "pl:493"]);
    const revenueCats = new Set(accountCategories().filter((c) => c.revenue).map((c) => c.key));
    const total = atStake(
      f.map((x) => ({ kind: x.statementKind, state: x.state, value: x.value, lineKey: x.lineKey })),
      () => null,
      revenueCats,
    );
    expect(total).toBe(hand);
    expect(hand).toBe(1_753_900);
  });

  it("every flag carries traceable evidence: trial balance row, base, materiality, rule + version", async () => {
    const w = (await flagsByKey()).get("pl:477")!;
    const ev = w.evidence as Record<string, unknown>;
    expect(ev.trial_balance).toEqual({ code: "477", name: "Wages and Salaries", ytd_net: 690_000, as_at: "2026-10-31" });
    expect(ev).toMatchObject({ statement_value: 690_000, base_label: "Revenue", base_value: expected.revenue, rule_id: "payroll_no_bridge", rule_version: 1 });
    expect(ev.detected_in_area).toEqual([{ app: "deputy", spend_12m: 2574, months_seen: 12 }]);
  });

  it("recommends top 3 plus the in-use app, with components and a reason", async () => {
    const f = (await flagsByKey()).get("pl:477")!;
    const recs = await withOrg(orgId, (tx) => tx.select().from(recommendations).where(eq(recommendations.flagId, f.id)));
    recs.sort((a, b) => a.rank - b.rank);
    expect(recs[0]!.appId).toBe("staffology");
    expect(recs[0]!.reason).toContain("Works directly with Deputy");
    expect(recs.some((r) => r.appId === "deputy" && r.inUse)).toBe(true);
    expect(recs.length).toBeLessThanOrEqual(4);
    const c = recs[0]!.components as Record<string, number>;
    expect(c.price_fit).toBe(0.5); // no price facts yet → neutral, never estimated
    expect(c.peer_results).toBe(0.5);
  });

  it("covered lines name the app; BS lines use total assets as the base", async () => {
    const f = await flagsByKey();
    expect((f.get("pl:200")!.evidence as Record<string, unknown>).covered_by).toBe("lightspeed");
    const ar = f.get("bs:610")!;
    expect((ar.evidence as Record<string, unknown>).base_label).toBe("Total assets");
  });
});

describe("guardrail: aggregates only", () => {
  it("no table stores row-level invoices or bank transactions", async () => {
    const db = await adminDb();
    const rows = rowsOf<{ table_name: string; column_name: string }>(
      await db.execute(sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`),
    );
    const cols = rows.map((r) => `${r.table_name}.${r.column_name}`);
    expect(cols.some((c) => /invoice_id|bank_transaction_id|line_item/.test(c))).toBe(false);
    expect(rows.some((r) => /^raw_/.test(r.table_name))).toBe(false);
  });
});
