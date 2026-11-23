/**
 * ENGINE-V2 §1.3 / §2.1: the trace behind GET /api/dev/engine/:org/:lineKey. Dev tools are on only when
 * DEV_TOOLS=true AND the signed-in user is an admin (checked on the server every time); otherwise 404.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { detectedApps, flags, orgs, recommendations, statementLines, statements, users } from "@/db/schema";
import { HttpError } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { apps as catalogApps, rulesFile, type ScoringV2 } from "@/lib/catalog/load";
import { adminDb, withOrg } from "@/lib/db/client";
import { env } from "@/lib/env";
import type { FlagOut } from "@/lib/signals/compute";
import { monthsBetween } from "@/lib/signals/run";
import { v2Apps } from "./apps";
import { rankFlagsV2, v2Lines } from "./run";
import { rulesVersion, v1Trace, v2Trace, withOverrides, type EngineTrace } from "./trace";

/** Throws 404 (not 403: the route shouldn't be discoverable) unless dev tools are on for this user. */
export async function requireDevTools(): Promise<{ userId: string }> {
  if (!env().DEV_TOOLS) throw new HttpError(404, "Not found");
  const s = await getSession();
  if (!s.userId) throw new HttpError(404, "Not found");
  const [u] = await (await adminDb()).select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, s.userId));
  if (!u?.isAdmin) throw new HttpError(404, "Not found");
  return { userId: s.userId };
}

export async function engineTrace(orgId: string, lineKey: string, engine: "v1" | "v2", overrides: unknown): Promise<EngineTrace> {
  const rf = rulesFile();
  const base = rf.scoring_v2;
  if (!base) throw new Error("catalog/rules.yaml has no scoring_v2");
  let scoring: ScoringV2;
  try {
    scoring = withOverrides(base, overrides as Parameters<typeof withOverrides>[1]);
  } catch {
    throw new HttpError(400, "weights: not a valid scoring_v2 override");
  }
  const computedAt = new Date().toISOString();
  return withOrg(orgId, async (tx) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
    if (!org) throw new HttpError(404, "Not found");
    const [latest] = await tx.select({ runId: statements.runId }).from(statements).orderBy(desc(statements.createdAt)).limit(1);
    if (!latest) throw new HttpError(404, "No refresh yet for this business");
    const runId = latest.runId;
    const rows = await tx.select().from(flags).where(eq(flags.runId, runId));
    const flag = rows.find((f) => f.lineKey === lineKey);
    if (!flag) throw new HttpError(404, `No line ${lineKey} in the latest refresh`);
    const stmts = await tx.select().from(statements).where(eq(statements.runId, runId));
    const names = stmts.length
      ? await tx.select({ lineKey: statementLines.lineKey, name: statementLines.name }).from(statementLines).where(inArray(statementLines.statementId, stmts.map((s) => s.id)))
      : [];
    const asFlags = rows.map(
      (f) =>
        ({
          kind: f.statementKind,
          lineKey: f.lineKey,
          xeroAccountId: f.xeroAccountId,
          ruleId: f.ruleId,
          ruleVersion: f.ruleVersion,
          value: f.value,
          base: f.base,
          materiality: f.materiality,
          band: f.band,
          coverageGap: f.coverageGap,
          strength: f.strength,
          state: f.state,
          evidence: (f.evidence ?? {}) as Record<string, unknown>,
          cause: null,
          recommendations: [],
        }) as unknown as FlagOut,
    );
    const lineNames = names.map((n) => ({ lineKey: n.lineKey, name: n.name }));
    const line = v2Lines(asFlags, lineNames).find((l) => l.lineKey === lineKey);
    if (!line) throw new HttpError(404, `Line ${lineKey} is ${flag.state}: engines rank flagged and covered lines only`);

    if (engine === "v1") {
      const recs = await tx.select().from(recommendations).where(eq(recommendations.flagId, flag.id));
      const nameOf = new Map(catalogApps().map((a) => [a.id, a.name]));
      return v1Trace(
        { orgId, computedAt, scoring: rf.scoring },
        line,
        recs.sort((a, b) => a.rank - b.rank).map((r) => ({ appId: r.appId, name: nameOf.get(r.appId) ?? r.appId, rank: r.rank, match: r.match, inUse: r.inUse, kind: r.kind, components: r.components as Record<string, number> })),
      );
    }
    const pl = stmts.find((s) => s.kind === "pl");
    const revenue = pl?.totals.revenue ?? 0;
    const months = pl?.periodFrom ? monthsBetween(pl.periodFrom, pl.periodTo) : 12;
    const detected = await tx.select({ appId: detectedApps.appId }).from(detectedApps).where(and(eq(detectedApps.orgId, orgId), eq(detectedApps.present, true)));
    const ranked = rankFlagsV2({
      flags: asFlags,
      lines: lineNames,
      inUse: detected.map((d) => d.appId),
      markets: org.markets,
      annualRevenue: months > 0 ? (revenue * 12) / months : revenue,
      headcount: null,
      today: computedAt.slice(0, 10),
      scoring,
      pool: v2Apps(),
    });
    const hit = ranked.find((r) => r.line.lineKey === lineKey);
    if (!hit) throw new HttpError(404, `No v2 ranking for ${lineKey}`);
    return v2Trace({ orgId, computedAt, scoring, rulesVersion: rulesVersion({ scoring, rule: hit.rule }) }, hit.line, hit.result);
  });
}
