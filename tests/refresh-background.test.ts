/** NEXT-STEPS P0.3: a refresh starts at once (run row, steps pending) and its steps run separately. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { orgs, syncRuns } from "@/db/schema";
import { executeRefresh, RefreshBusyError, startRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { refreshRun } from "@/lib/api/contract";
import { resetEnv } from "@/lib/env";

let close: () => Promise<void>;
let orgId: string;
beforeAll(async () => {
  close = (await freshDb()).close;
  orgId = (await (await adminDb()).insert(orgs).values({ name: "Background Ltd (sample)", sample: true }).returning())[0]!.id;
});
afterAll(() => close());

describe("background refresh", () => {
  it("start returns a running run with every step pending; a second start is refused until it ends", async () => {
    const run = await startRefresh(orgId);
    const view = (await refreshRun(orgId, run.id))!;
    expect(view.status).toBe("running");
    expect(view.steps.every((s) => s.status === "pending")).toBe(true);
    await expect(startRefresh(orgId)).rejects.toBeInstanceOf(RefreshBusyError);
    await executeRefresh(orgId, run, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
    const done = (await refreshRun(orgId, run.id))!;
    expect(done.status).toBe("ok");
    expect(done.steps.every((s) => s.status === "done")).toBe(true);
  });

  it("NEXT-STEPS P1.10: with few Xero calls left today, the apps step is skipped and the run is partial", async () => {
    const run = await startRefresh(orgId);
    const client = new FixtureXeroClient("demo-uk-synthetic", orgId);
    client.limits.day = 40; // as if X-DayLimit-Remaining said 40
    await executeRefresh(orgId, run, { client, now: new Date("2026-11-04T10:00:00Z") });
    const [r] = await (await adminDb()).select().from(syncRuns).where(eq(syncRuns.id, run.id));
    expect(r!.status).toBe("partial");
    const apps = r!.steps.find((s) => s.key === "apps")!;
    expect(apps.status).toBe("error");
    expect(apps.error).toContain("40 Xero calls left today");
    expect(r!.steps.find((s) => s.key === "reports")!.status).toBe("ok");
  });

  it("a business with no usable Xero connection fails at once instead of staying 'running'", async () => {
    process.env.XERO_MODE = "live"; // fixtures mode would hand back a fixture client
    resetEnv();
    const run = await startRefresh(orgId);
    await expect(executeRefresh(orgId, run)).rejects.toThrow();
    delete process.env.XERO_MODE;
    resetEnv();
    const [r] = await (await adminDb()).select().from(syncRuns).where(eq(syncRuns.id, run.id));
    expect(r!.status).toBe("error");
    expect(r!.finishedAt).not.toBeNull();
    expect((await refreshRun(orgId, run.id))!.error?.retryable).toBe(true);
  });
});
