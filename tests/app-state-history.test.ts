/** NEXT-STEPS P2.14: lifecycle history of detected apps; contributions table exists, owner-only. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { appStateHistory, detectedApps, orgs } from "@/db/schema";
import { stateChanges } from "@/lib/detect";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";

describe("stateChanges (pure)", () => {
  it("records appearances, changes and disappearances; nothing for unchanged apps", () => {
    const before = new Map<string, string | null>([["dext", "active"], ["pleo", "active"], ["gone", "lapsing"]]);
    const after = new Map<string, string | null>([["dext", "active"], ["pleo", "lapsing"], ["new1", "new"]]);
    expect(stateChanges(before, after)).toEqual([
      { appId: "gone", fromState: "lapsing", state: null },
      { appId: "new1", fromState: null, state: "new" },
      { appId: "pleo", fromState: "active", state: "lapsing" },
    ]);
    expect(stateChanges(after, after)).toEqual([]);
  });
});

describe("detection writes app_state_history", () => {
  let close: () => Promise<void>;
  let orgId: string;
  const refresh = () => runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
  beforeAll(async () => {
    close = (await freshDb()).close;
    orgId = (await (await adminDb()).insert(orgs).values({ name: "History Ltd (sample)", sample: true }).returning())[0]!.id;
  });
  afterAll(() => close());

  it("first run: one row per detected app; a second identical run adds none", async () => {
    await refresh();
    const apps = await withOrg(orgId, (tx) => tx.select().from(detectedApps));
    const h1 = await withOrg(orgId, (tx) => tx.select().from(appStateHistory));
    expect(apps.length).toBeGreaterThan(0);
    expect(h1).toHaveLength(apps.length);
    expect(h1.every((r) => r.fromState === null && r.state !== null)).toBe(true);
    await refresh();
    expect(await withOrg(orgId, (tx) => tx.select().from(appStateHistory))).toHaveLength(apps.length);
  });

  it("contributions: owner-only (RLS on, the app role can't read it)", async () => {
    const db = await adminDb();
    const rls = await db.execute(sql`select relrowsecurity as on from pg_class where relname = 'contributions'`);
    const rows = (Array.isArray(rls) ? rls : (rls as unknown as { rows: { on: boolean }[] }).rows) as { on: boolean }[];
    expect(rows[0]!.on).toBe(true);
    await expect(withOrg(orgId, (tx) => tx.execute(sql`select count(*) from contributions`))).rejects.toThrow();
  });
});
