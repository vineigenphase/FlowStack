/**
 * Installs and check-ins (CLAUDE.md §7.6): create an install (user marks it, or detection sees a recommended app's
 * first bills), schedule day 7/30/90 (+ renewal −60), and evaluate due check-ins from stored rows.
 */
import { and, desc, eq, inArray, lte, ne } from "drizzle-orm";
import { checkins, detectedApps, flags, installs, recommendations, statementLines, statements, type InstallBaseline } from "@/db/schema";
import { adminDb, withOrg, type Db } from "@/lib/db/client";
import { apps as catalogApps } from "@/lib/catalog/load";
import { HttpError } from "@/lib/api";
import { evaluateCheckin, schedule, type PeerBand } from "./evaluate";

export const PEER_K = 10;
const appName = (id: string) => catalogApps().find((a) => a.id === id)?.name ?? id;
const today = () => new Date().toISOString().slice(0, 10);
export type PeerLookup = (appId: string, orgId: string) => Promise<PeerBand | null>;

async function latestRunId(tx: Db) {
  const [s] = await tx.select({ runId: statements.runId }).from(statements).orderBy(desc(statements.createdAt)).limit(1);
  return s?.runId ?? null;
}

/** The line as it stands in the latest run: state from the flag, value and name from the statement. */
async function currentLine(tx: Db, lineKey: string) {
  const runId = await latestRunId(tx);
  if (!runId) return null;
  const [f] = await tx.select().from(flags).where(and(eq(flags.runId, runId), eq(flags.lineKey, lineKey)));
  const [l] = await tx
    .select({ name: statementLines.name, value: statementLines.value })
    .from(statementLines)
    .innerJoin(statements, eq(statements.id, statementLines.statementId))
    .where(and(eq(statements.runId, runId), eq(statementLines.lineKey, lineKey)));
  if (!l) return null;
  return { runId, state: f?.state ?? "fine", value: f?.value ?? l.value, name: l.name };
}

async function baselineFor(tx: Db, lineKey: string | null): Promise<InstallBaseline> {
  if (!lineKey) return { lineValue: null, lineState: null, lineName: null, runId: null };
  const l = await currentLine(tx, lineKey);
  return { lineValue: l?.value ?? null, lineState: l?.state ?? null, lineName: l?.name ?? null, runId: l?.runId ?? null };
}

async function insertSchedule(tx: Db, orgId: string, installId: string, installedOn: string, renewalOn: string | null) {
  for (const s of schedule(installedOn, renewalOn)) {
    await tx.insert(checkins).values({ orgId, installId, kind: s.kind, dueOn: s.dueOn }).onConflictDoNothing();
  }
}

/** A user marks an app as installed (optionally for a line, with a renewal date). Idempotent per app. */
export async function markInstalled(
  orgId: string,
  i: { appId: string; lineKey?: string | null; installedOn?: string; renewalOn?: string | null; userId?: string | null },
) {
  if (!catalogApps().some((a) => a.id === i.appId)) throw new HttpError(404, "App not found");
  const installedOn = i.installedOn ?? today();
  if (installedOn > today()) throw new HttpError(422, "Install date can't be in the future");
  return withOrg(orgId, async (tx) => {
    const [existing] = await tx.select().from(installs).where(eq(installs.appId, i.appId));
    if (existing && existing.status === "active") return existing;
    const baseline = await baselineFor(tx, i.lineKey ?? null);
    const values = { orgId, appId: i.appId, lineKey: i.lineKey ?? null, baseline, source: "user" as const, installedOn, renewalOn: i.renewalOn ?? null, status: "active" as const, createdBy: i.userId ?? null };
    const [row] = existing
      ? await tx.update(installs).set(values).where(eq(installs.id, existing.id)).returning()
      : await tx.insert(installs).values(values).returning();
    if (existing) await tx.delete(checkins).where(eq(checkins.installId, existing.id));
    await insertSchedule(tx, orgId, row!.id, installedOn, row!.renewalOn);
    return row!;
  });
}

/** Set or change the renewal date; reschedules the renewal check-in. */
export async function setRenewal(orgId: string, installId: string, renewalOn: string | null) {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx.update(installs).set({ renewalOn }).where(eq(installs.id, installId)).returning();
    if (!row) throw new HttpError(404, "Install not found");
    await tx.delete(checkins).where(and(eq(checkins.installId, installId), eq(checkins.kind, "renewal")));
    await insertSchedule(tx, orgId, installId, row.installedOn, renewalOn);
    return row;
  });
}

export async function removeInstall(orgId: string, installId: string) {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx.update(installs).set({ status: "removed" }).where(eq(installs.id, installId)).returning();
    if (!row) throw new HttpError(404, "Install not found");
    await tx.delete(checkins).where(and(eq(checkins.installId, installId), eq(checkins.status, "pending")));
    return row;
  });
}

const monthsBefore = (day: string, n: number) => {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * Detection saw a recommended app start billing: its first bill is in the last two months and it's one of the
 * apps we suggested for a line. Creates a "detected" install dated to that first bill. Runs after flags.
 */
export async function detectInstalls(tx: Db, orgId: string, asAt: string) {
  const runId = await latestRunId(tx);
  if (!runId) return 0;
  const det = await tx.select().from(detectedApps);
  const have = new Set((await tx.select({ appId: installs.appId }).from(installs)).map((r) => r.appId));
  const recent = monthsBefore(asAt, 2);
  let made = 0;
  for (const d of det) {
    if (have.has(d.appId)) continue;
    const months = Object.keys((d.evidence as { monthly?: Record<string, number> }).monthly ?? {}).sort();
    const first = months[0];
    if (!first || first < recent) continue;
    // Which line did we suggest it for? Prefer a run before this one (the line before the app showed up).
    const recs = await tx
      .select({ lineKey: flags.lineKey, runId: flags.runId, kind: flags.statementKind, strength: flags.strength })
      .from(recommendations)
      .innerJoin(flags, eq(flags.id, recommendations.flagId))
      .where(eq(recommendations.appId, d.appId))
      .orderBy(desc(flags.createdAt));
    if (!recs.length) continue;
    // Suggested for several lines? Take the run before this one if there is one, then the line that matters most:
    // profit and loss before balance sheet, then the strongest flag.
    const prevRun = recs.find((r) => r.runId !== runId)?.runId ?? recs[0]!.runId;
    const before = recs
      .filter((r) => r.runId === prevRun)
      .sort((a, b) => Number(b.kind === "pl") - Number(a.kind === "pl") || b.strength - a.strength)[0]!;
    const [old] = await tx.select().from(flags).where(and(eq(flags.runId, before.runId), eq(flags.lineKey, before.lineKey)));
    const now = await currentLine(tx, before.lineKey);
    const baseline: InstallBaseline = { lineValue: old?.value ?? now?.value ?? null, lineState: old?.state ?? now?.state ?? null, lineName: now?.name ?? null, runId: before.runId };
    const [row] = await tx
      .insert(installs)
      .values({ orgId, appId: d.appId, lineKey: before.lineKey, baseline, source: "detected", installedOn: first })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await insertSchedule(tx, orgId, row.id, first, null);
      made++;
    }
  }
  return made;
}

/** Evaluate this org's check-ins that are due and still pending. */
export async function evaluateDue(orgId: string, opts: { on?: string; peer?: PeerLookup } = {}) {
  const on = opts.on ?? today();
  const peer = opts.peer ?? (async () => null);
  const due = await withOrg(orgId, (tx) =>
    tx
      .select({ c: checkins, i: installs })
      .from(checkins)
      .innerJoin(installs, eq(installs.id, checkins.installId))
      .where(and(eq(checkins.status, "pending"), lte(checkins.dueOn, on), ne(installs.status, "removed"))),
  );
  if (!due.length) return 0;
  const bands = new Map<string, PeerBand | null>();
  for (const { i } of due) if (!bands.has(i.appId)) bands.set(i.appId, await peer(i.appId, orgId));
  return withOrg(orgId, async (tx) => {
    const det = await tx.select().from(detectedApps).where(inArray(detectedApps.appId, [...new Set(due.map((d) => d.i.appId))]));
    const monthlyOf = new Map(det.map((d) => [d.appId, (d.evidence as { monthly?: Record<string, number> }).monthly ?? null]));
    for (const { c, i } of due) {
      const line = i.lineKey ? await currentLine(tx, i.lineKey) : null;
      const r = evaluateCheckin({
        kind: c.kind,
        appName: appName(i.appId),
        installedOn: i.installedOn,
        monthly: monthlyOf.get(i.appId) ?? null,
        baseline: i.baseline,
        line,
        peer: bands.get(i.appId) ?? null,
        k: PEER_K,
      });
      await tx.update(checkins).set({ status: r.status, result: r.result, checkedAt: new Date() }).where(and(eq(checkins.installId, c.installId), eq(checkins.kind, c.kind)));
    }
    return due.length;
  });
}

/** Orgs with a pending check-in due on or before `on` (owner connection; used by the nightly cron). */
export async function orgsWithDueCheckins(on = today()) {
  const db = await adminDb();
  const rows = await db.selectDistinct({ orgId: checkins.orgId }).from(checkins).where(and(eq(checkins.status, "pending"), lte(checkins.dueOn, on)));
  return rows.map((r) => r.orgId);
}

/** After-install page data for one org. */
export async function afterInstallView(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const rows = await tx.select().from(installs).where(eq(installs.status, "active")).orderBy(desc(installs.installedOn));
    if (!rows.length) return [];
    const cs = await tx.select().from(checkins).where(inArray(checkins.installId, rows.map((r) => r.id)));
    const det = await tx.select().from(detectedApps).where(inArray(detectedApps.appId, rows.map((r) => r.appId)));
    const ORDER = ["d7", "d30", "d90", "renewal"];
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        name: appName(r.appId),
        line: r.lineKey ? await currentLine(tx, r.lineKey) : null,
        monthly: ((det.find((d) => d.appId === r.appId)?.evidence ?? {}) as { monthly?: Record<string, number> }).monthly ?? {},
        checkins: cs.filter((c) => c.installId === r.id).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)),
      })),
    );
  });
}
