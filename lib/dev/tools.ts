/**
 * ENGINE-V2 §2: server side of the dev tools (rail, review box, Engine panel). Dev tools are on only when
 * DEV_TOOLS=true AND the signed-in user is an admin in the database. Checked on the server for every page and route;
 * the client only shows and hides. Uses the owner connection: never call from inside withOrg().
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { orgs, reviewQueue, statementLines, users } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { adminDb, withOrg } from "@/lib/db/client";
import { env } from "@/lib/env";
import { KIND_LABELS } from "@/lib/queue/view";
import type { QueueKind } from "@/lib/queue/enqueue";

export async function devToolsOn(): Promise<boolean> {
  if (!env().DEV_TOOLS) return false;
  const s = await getSession();
  if (!s.userId) return false;
  const [u] = await (await adminDb()).select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, s.userId));
  return Boolean(u?.isAdmin);
}

export type QueueSummary = {
  total: number;
  high: number;
  byKind: { kind: string; label: string; normal: number; high: number }[];
  oldest: { id: string; kind: string; label: string; org: string | null; createdAt: string; priority: "high" | "normal" }[];
};

/** Open review items: counts by kind and priority, and the 5 oldest (optionally for one business). */
export async function queueSummary(orgId?: string | null): Promise<QueueSummary> {
  const db = await adminDb();
  const where = orgId ? and(eq(reviewQueue.status, "open"), eq(reviewQueue.orgId, orgId)) : eq(reviewQueue.status, "open");
  const counts = await db
    .select({ kind: reviewQueue.kind, priority: reviewQueue.priority, n: sql<number>`count(*)::int` })
    .from(reviewQueue)
    .where(where)
    .groupBy(reviewQueue.kind, reviewQueue.priority);
  const oldest = await db
    .select({ id: reviewQueue.id, kind: reviewQueue.kind, priority: reviewQueue.priority, createdAt: reviewQueue.createdAt, org: orgs.name })
    .from(reviewQueue)
    .leftJoin(orgs, eq(orgs.id, reviewQueue.orgId))
    .where(where)
    .orderBy(asc(reviewQueue.createdAt))
    .limit(5);
  const label = (k: string) => KIND_LABELS[k as QueueKind] ?? k;
  const kinds = new Map<string, { kind: string; label: string; normal: number; high: number }>();
  for (const c of counts) {
    const row = kinds.get(c.kind) ?? { kind: c.kind, label: label(c.kind), normal: 0, high: 0 };
    row[c.priority] += c.n;
    kinds.set(c.kind, row);
  }
  const byKind = [...kinds.values()].sort((a, b) => b.high + b.normal - (a.high + a.normal));
  return {
    total: byKind.reduce((t, k) => t + k.normal + k.high, 0),
    high: byKind.reduce((t, k) => t + k.high, 0),
    byKind,
    oldest: oldest.map((o) => ({ id: o.id, kind: o.kind, label: label(o.kind), org: o.org, createdAt: o.createdAt.toISOString(), priority: o.priority })),
  };
}

/**
 * Lines that need a person in this business (ENGINE-V2 §2.2): an open flag_disputed item (by line key) or an open
 * account_mapping item (by Xero account id). Queued lines are added by the page from the flag state.
 */
export async function needsPerson(orgId: string): Promise<{ lineKeys: string[]; accountIds: string[] }> {
  const rows = await (await adminDb())
    .select({ kind: reviewQueue.kind, ref: reviewQueue.ref })
    .from(reviewQueue)
    .where(and(eq(reviewQueue.status, "open"), eq(reviewQueue.orgId, orgId), inArray(reviewQueue.kind, ["flag_disputed", "account_mapping"])));
  const lineKeys = rows.filter((r) => r.kind === "flag_disputed").map((r) => (r.ref as { line_key?: string }).line_key).filter((x): x is string => !!x);
  const accountIds = rows.filter((r) => r.kind === "account_mapping").map((r) => (r.ref as { xero_account_id?: string }).xero_account_id).filter((x): x is string => !!x);
  return { lineKeys: [...new Set(lineKeys)], accountIds: [...new Set(accountIds)] };
}

/** Line keys needing a person: disputed lines, plus the lines of accounts with an open mapping item. */
export async function needsPersonLines(orgId: string): Promise<Set<string>> {
  const np = await needsPerson(orgId); // owner connection first, then the tenant read (never nested)
  const byAccount = np.accountIds.length
    ? await withOrg(orgId, (tx) => tx.select({ lineKey: statementLines.lineKey }).from(statementLines).where(inArray(statementLines.xeroAccountId, np.accountIds)))
    : [];
  return new Set([...np.lineKeys, ...byAccount.map((r) => r.lineKey)]);
}
