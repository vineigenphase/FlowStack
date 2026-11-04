/** Load what flag computation needs for one run, compute, and store flags + recommendations. */
import { and, eq, inArray } from "drizzle-orm";
import { appFacts, detectedApps, flags, lineOverrides, orgs, recommendations, statementLines, statements, trialBalance } from "@/db/schema";
import { withOrg } from "@/lib/db/client";
import { env } from "@/lib/env";
import { apps as catalogApps, rulesFile } from "@/lib/catalog/load";
import { accountInfo } from "@/lib/statements/accounts";
import { computeFlags as compute, type LineIn, type TbRow } from "./compute";

const CREDIT_CLASSES = new Set(["REVENUE", "LIABILITY", "EQUITY"]);
const PRICE_FIELDS = ["price_from_gbp", "price_model"];

export function monthsBetween(from: string, to: string) {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
}

export async function computeFlags(orgId: string, runId: string) {
  return withOrg(orgId, async (tx) => {
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
    const stmts = await tx.select().from(statements).where(eq(statements.runId, runId));
    const pl = stmts.find((s) => s.kind === "pl");
    const bs = stmts.filter((s) => s.kind === "bs").sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0];
    const cf = stmts.find((s) => s.kind === "cf");
    if (!org || !pl || !bs) return { flags: 0 };

    const ids = [pl.id, bs.id, ...(cf ? [cf.id] : [])];
    const kindOf = new Map(ids.map((id) => [id, stmts.find((s) => s.id === id)!.kind]));
    const rawLines = await tx.select().from(statementLines).where(inArray(statementLines.statementId, ids));
    const info = await accountInfo(tx);

    const lines: LineIn[] = rawLines
      .filter((l) => l.lineKey !== "bs:current_year_earnings" && l.lineKey !== "cf:net_profit")
      .map((l) => ({
        kind: kindOf.get(l.statementId)!,
        lineKey: l.lineKey,
        xeroAccountId: l.xeroAccountId,
        code: l.code,
        name: l.name,
        category: l.xeroAccountId ? (info.get(l.xeroAccountId)?.category ?? null) : l.category,
        value: l.value,
      }));

    const tbRows = await tx.select().from(trialBalance).where(eq(trialBalance.runId, runId));
    const classOf = new Map(
      (await tx.query.accounts.findMany({ columns: { xeroAccountId: true, class: true } })).map((a) => [a.xeroAccountId, a.class]),
    );
    const tb = new Map<string, TbRow>(
      tbRows.map((t) => {
        const net = t.ytdDebit - t.ytdCredit;
        const signed = CREDIT_CLASSES.has(classOf.get(t.xeroAccountId) ?? "") ? -net : net;
        return [t.xeroAccountId, { code: t.code, name: t.name, ytd_net: Math.round(signed * 100) / 100, as_at: t.asAt }];
      }),
    );

    const detected = await tx.select().from(detectedApps).where(and(eq(detectedApps.orgId, orgId), eq(detectedApps.present, true)));
    const overrides = await tx.select().from(lineOverrides);
    const facts = await tx.select().from(appFacts).where(inArray(appFacts.field, PRICE_FIELDS));
    const prices = new Map<string, { known: boolean }>();
    for (const f of facts) if (f.field === "price_from_gbp" && (f.state === "verified" || f.state === "found") && f.value !== null) prices.set(f.appId, { known: true });

    const rf = rulesFile();
    const out = compute(lines, {
      revenue: pl.totals.revenue ?? 0,
      totalAssets: bs.totals.total_assets ?? 0,
      monthsInPeriod: pl.periodFrom ? monthsBetween(pl.periodFrom, pl.periodTo) : 12,
      cfReconciled: Boolean(cf?.reconciled),
      rules: rf.rules,
      apps: catalogApps(),
      markets: org.markets,
      inUse: new Map(detected.map((d) => [d.appId, { appId: d.appId, spend12m: d.spend12m, monthsSeen: d.monthsSeen }])),
      prices,
      overrides: new Set(overrides.map((o) => `${o.lineKey}|${o.ruleId}`)),
      tb,
      bands: { high: env().HIGH_BAND, medium: env().MED_BAND },
      scoring: rf.scoring,
    });

    await tx.delete(flags).where(eq(flags.runId, runId));
    for (const f of out) {
      const [row] = await tx
        .insert(flags)
        .values({
          orgId,
          runId,
          statementKind: f.kind,
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
          evidence: { ...f.evidence, cause: f.cause },
        })
        .returning({ id: flags.id });
      if (f.recommendations.length) {
        await tx.insert(recommendations).values(
          f.recommendations.map((r) => ({
            flagId: row!.id,
            orgId,
            appId: r.appId,
            rank: r.rank,
            match: r.match,
            components: r.components,
            inUse: r.inUse,
            reason: r.reason,
          })),
        );
      }
    }
    return { flags: out.length, flagged: out.filter((f) => f.state === "flagged").length };
  });
}
