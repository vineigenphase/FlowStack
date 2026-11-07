import { desc, eq } from "drizzle-orm";
import { handle } from "@/lib/api";
import { requireCron } from "@/lib/cron";
import { markStale } from "@/lib/crawl";
import { adminDb } from "@/lib/db/client";
import { syncRuns } from "@/db/schema";
import { evaluateDue, orgsWithDueCheckins } from "@/lib/checkins";
import { peerBand } from "@/lib/prices";
import { runRefresh } from "@/lib/sync/refresh";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A check-in should judge fresh figures: refresh orgs whose last good run is older than this first. */
const STALE_MS = 3 * 86_400_000;
/** Refreshes per night (each is ~10–25 read-only Xero calls); the rest are judged on what's stored and caught next night. */
const MAX_REFRESH = 5;

/**
 * 02:17 daily:
 *  - catalogue facts not confirmed for 90 days → stale + queue
 *  - after-install check-ins that are due (CLAUDE.md §7.6), refreshing a few stale orgs first
 */
export const GET = handle(async (req: Request) => {
  requireCron(req);
  const stale = await markStale();
  const db = await adminDb();
  const due = await orgsWithDueCheckins();
  let refreshed = 0;
  let judged = 0;
  for (const orgId of due) {
    try {
      const [last] = await db.select().from(syncRuns).where(eq(syncRuns.orgId, orgId)).orderBy(desc(syncRuns.startedAt)).limit(1);
      const old = !last || last.status !== "ok" || Date.now() - last.startedAt.getTime() > STALE_MS;
      // A refresh ends in recompute(), which judges due check-ins itself.
      if (old && refreshed < MAX_REFRESH) {
        refreshed++;
        await runRefresh(orgId);
      }
      judged += await evaluateDue(orgId, { peer: peerBand });
    } catch (e) {
      log.error({ err: { message: (e as Error).message }, orgId }, "nightly check-ins failed for org");
    }
  }
  return { stale, checkins: { orgs: due.length, refreshed, judged } };
});
