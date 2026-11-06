/** One refresh at a time per org (sync_runs_one_running), and dead runs don't block the next one. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { orgs, syncRuns } from "@/db/schema";
import { ABANDONED_AFTER_MS, RefreshBusyError, runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";

let close: () => Promise<void>;
let orgId: string;
const opts = () => ({ client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });

beforeAll(async () => {
  const h = await freshDb();
  close = h.close;
  const [o] = await (await adminDb()).insert(orgs).values({ name: "Copperpot (sample)", sample: true }).returning();
  orgId = o!.id;
});
afterAll(() => close());

describe("refresh guard", () => {
  it("two refreshes at once: one runs, the other is refused as busy", async () => {
    const results = await Promise.allSettled([runRefresh(orgId, opts()), runRefresh(orgId, opts())]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reason).toBeInstanceOf(RefreshBusyError);
    const runs = await (await adminDb()).select().from(syncRuns).where(eq(syncRuns.orgId, orgId));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("ok");
  });

  it("a run left 'running' past the cut-off is closed as abandoned and doesn't block", async () => {
    const db = await adminDb();
    const [dead] = await db
      .insert(syncRuns)
      .values({ orgId, startedAt: new Date(Date.now() - ABANDONED_AFTER_MS - 60_000) })
      .returning();
    const out = await runRefresh(orgId, opts());
    expect(out.status).toBe("ok");
    const [after] = await db.select().from(syncRuns).where(eq(syncRuns.id, dead!.id));
    expect(after!.status).toBe("error");
    expect(after!.error).toMatch(/Abandoned/);
  });

  it("a recent run still marked running blocks a new one", async () => {
    const db = await adminDb();
    await db.insert(syncRuns).values({ orgId, startedAt: new Date() });
    await expect(runRefresh(orgId, opts())).rejects.toBeInstanceOf(RefreshBusyError);
  });
});
