/** CLAUDE.md §7.6 after-install check-ins, and §7.3b peer prices (k ≥ 10, opt-in). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { checkins, detectedApps, installs, orgs, priceObservations } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { addDays, evaluateCheckin, schedule, typicalMonthly, type CheckinCtx } from "@/lib/checkins/evaluate";
import { afterInstallView, detectInstalls, evaluateDue, markInstalled, removeInstall, setRenewal } from "@/lib/checkins";
import { bandOf, peerBand, percentile, recordObservations, sizeBand } from "@/lib/prices";

const base: CheckinCtx = {
  kind: "d7",
  appName: "Staffology Payroll",
  installedOn: "2026-08-10",
  monthly: null,
  baseline: { lineValue: 690000, lineState: "flagged", lineName: "Wages and Salaries", runId: "r" },
  line: { state: "flagged", value: 690000, name: "Wages and Salaries" },
  peer: null,
  k: 10,
};

describe("evaluateCheckin (pure)", () => {
  it("day 7: a bill since install month is ok; none is not_yet, never failed", () => {
    expect(evaluateCheckin({ ...base, monthly: { "2026-07-01": 50 } }).status).toBe("not_yet");
    const ok = evaluateCheckin({ ...base, monthly: { "2026-08-01": 49.5 } });
    expect(ok.status).toBe("ok");
    expect(ok.result.detail).toContain("£50 in August 2026");
  });

  it("day 30: handled line is ok, still flagged is not_yet", () => {
    expect(evaluateCheckin({ ...base, kind: "d30", line: { ...base.line!, state: "covered" } }).status).toBe("ok");
    const r = evaluateCheckin({ ...base, kind: "d30" });
    expect(r.status).toBe("not_yet");
    expect(r.result.headline).toBe("Wages and Salaries is still flagged");
  });

  it("day 90: still flagged fails, with the before/after figures", () => {
    const r = evaluateCheckin({ ...base, kind: "d90", line: { ...base.line!, value: 655500 } });
    expect(r.status).toBe("failed");
    expect(r.result.numbers).toEqual({ before: 690000, after: 655500, change_pct: -5 });
    expect(evaluateCheckin({ ...base, kind: "d90", line: { ...base.line!, state: "covered" } }).status).toBe("ok");
  });

  it("renewal: under 10 peers says so instead of guessing; above p75 is flagged", () => {
    const monthly = { "2026-06-01": 100, "2026-07-01": 120, "2026-08-01": 110 };
    const few = evaluateCheckin({ ...base, kind: "renewal", monthly, peer: { n: 9, p25: 1, median: 2, p75: 3 } });
    expect(few.status).toBe("info");
    expect(few.result.detail).toContain("Not enough similar businesses");
    const high = evaluateCheckin({ ...base, kind: "renewal", monthly, peer: { n: 12, p25: 60, median: 80, p75: 95 } });
    expect(high.status).toBe("failed");
    expect(high.result.numbers?.monthly).toBe(110);
  });

  it("schedule: 7/30/90 from install, renewal 60 days before", () => {
    expect(schedule("2026-01-31", "2026-12-01")).toEqual([
      { kind: "d7", dueOn: "2026-02-07" },
      { kind: "d30", dueOn: "2026-03-02" },
      { kind: "d90", dueOn: "2026-05-01" },
      { kind: "renewal", dueOn: "2026-10-02" },
    ]);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(typicalMonthly({ a: 10, b: 0, c: 30, d: 20, e: 99 })).toBe(30); // last three billed months by key: e, d, c
  });
});

describe("peer price statistics (pure)", () => {
  it("percentiles, size bands, k-anonymity", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(sizeBand(2_566_400, "2026-04-01", "2026-10-31")).toBe("1m_5m");
    expect(sizeBand(100, "2026-10-20", "2026-10-31")).toBeNull();
    const nine = new Map(Array.from({ length: 9 }, (_, i) => [`o${i}`, [10 + i]]));
    expect(bandOf(nine)).toBeNull();
    nine.set("o9", [19]);
    expect(bandOf(nine)).toEqual({ n: 10, p25: 12.25, median: 14.5, p75: 16.75 });
  });
});

describe("installs and check-ins (db)", () => {
  let close: () => Promise<void>;
  let orgId: string;
  const asAt = "2026-10-31";

  beforeAll(async () => {
    const h = await freshDb();
    close = h.close;
    const db = await adminDb();
    const [o] = await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true }).returning();
    orgId = o!.id;
    await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
  });
  afterAll(() => close());

  it("marking an install records the line's baseline and schedules day 7/30/90", async () => {
    const i = await markInstalled(orgId, { appId: "staffology", lineKey: "pl:477", installedOn: "2026-08-01" });
    expect(i.baseline).toMatchObject({ lineState: "flagged", lineName: "Wages and Salaries" });
    expect(i.baseline.lineValue).toBeGreaterThan(0);
    const cs = await withOrg(orgId, (tx) => tx.select().from(checkins).where(eq(checkins.installId, i.id)));
    expect(cs.map((c) => c.kind).sort()).toEqual(["d30", "d7", "d90"]);
    // Idempotent per app.
    expect((await markInstalled(orgId, { appId: "staffology" })).id).toBe(i.id);
  });

  it("due check-ins are judged from stored figures; future ones stay pending", async () => {
    const n = await evaluateDue(orgId, { on: "2026-09-15" });
    expect(n).toBe(2); // d7 and d30 are due, d90 (2026-10-30) isn't
    const v = await afterInstallView(orgId);
    const s = v.find((x) => x.appId === "staffology")!;
    expect(s.checkins.map((c) => [c.kind, c.status])).toEqual([
      ["d7", "not_yet"],
      ["d30", "not_yet"],
      ["d90", "pending"],
    ]);
    expect(s.checkins[1]!.result?.headline).toBe("Wages and Salaries is still flagged");
  });

  it("a renewal date adds the renewal check; removing the install drops pending ones", async () => {
    const [i] = await withOrg(orgId, (tx) => tx.select().from(installs).where(eq(installs.appId, "staffology")));
    await setRenewal(orgId, i!.id, "2027-03-01");
    const [r] = await withOrg(orgId, (tx) => tx.select().from(checkins).where(and(eq(checkins.installId, i!.id), eq(checkins.kind, "renewal"))));
    expect(r!.dueOn).toBe("2026-12-31");
    await removeInstall(orgId, i!.id);
    const left = await withOrg(orgId, (tx) => tx.select().from(checkins).where(eq(checkins.installId, i!.id)));
    expect(left.every((c) => c.status !== "pending")).toBe(true);
  });

  it("detection: a recommended app whose first bill is recent becomes a detected install", async () => {
    // MarketMan is recommended for 310 Cost of Goods Sold in the fixture; pretend its first bill just arrived.
    await withOrg(orgId, (tx) =>
      tx.insert(detectedApps).values({
        orgId,
        appId: "marketman",
        spend12m: 300,
        monthsSeen: 1,
        lastSeen: "2026-10-01",
        present: false,
        evidence: { contacts: [], sources: ["bill"], monthly: { "2026-10-01": 300 } },
      }),
    );
    const made = await withOrg(orgId, (tx) => detectInstalls(tx, orgId, asAt));
    expect(made).toBe(1);
    const [i] = await withOrg(orgId, (tx) => tx.select().from(installs).where(eq(installs.appId, "marketman")));
    expect(i).toMatchObject({ source: "detected", lineKey: "pl:310", installedOn: "2026-10-01" });
    // Running again doesn't duplicate.
    expect(await withOrg(orgId, (tx) => detectInstalls(tx, orgId, asAt))).toBe(0);
  });

  it("peer prices: opt-in only, sample orgs never count, and nothing shows under 10 businesses", async () => {
    const db = await adminDb();
    // The sample org opting in still records nothing.
    await db.update(orgs).set({ sharePrices: true }).where(eq(orgs.id, orgId));
    expect(await recordObservations(orgId)).toBe(0);

    const peers: string[] = [];
    for (let i = 0; i < 10; i++) {
      const [o] = await db.insert(orgs).values({ name: `Peer ${i}`, sharePrices: true }).returning();
      peers.push(o!.id);
      const month = new Date();
      month.setUTCMonth(month.getUTCMonth() - 1);
      await db.insert(priceObservations).values({ appId: "dext", orgId: o!.id, month: `${month.toISOString().slice(0, 7)}-01`, amount: 40 + i * 5 });
    }
    expect(await peerBand("dext")).toMatchObject({ n: 10, median: 62.5, scope: "all sizes" });
    // Asking as one of the ten leaves it out: 9 → nothing.
    expect(await peerBand("dext", peers[0])).toBeNull();
    // Withdrawn consent removes a business at once, even before its rows are rewritten.
    await db.update(orgs).set({ sharePrices: false }).where(eq(orgs.id, peers[1]!));
    expect(await peerBand("dext")).toBeNull();
  });
});
