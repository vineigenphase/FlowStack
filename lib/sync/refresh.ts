/**
 * One refresh (BACKEND.md §3.4): fetch → persist → recompute.
 * Inline in dev mode (D10). Raw report JSON is parsed and dropped, never stored.
 *
 * Everything after the fetch (categories on lines, derived cash flow, flags) runs from stored rows in
 * `recompute()`, so resolving a review item can recompute the org without calling Xero again.
 */
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  accountMaps,
  accounts,
  orgs,
  statementLines,
  statements,
  syncRuns,
  trialBalance,
  type RunStep,
} from "@/db/schema";
import { adminDb, withOrg, type Db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { errorText } from "./error-text";
import { accountCategories, mappingCatalog } from "@/lib/catalog/load";
import { mapAccounts } from "@/lib/mapping";
import { buildBS, buildPL, type Statement, type StatementLine } from "@/lib/statements/build";
import { accountInfo } from "@/lib/statements/accounts";
import { deriveCashFlow } from "@/lib/statements/cashflow";
import { autoClose, enqueueAll, type QueueItem } from "@/lib/queue/enqueue";
import { clientForOrg } from "@/lib/xero";
import type { XeroClient } from "@/lib/xero/client";
import { getAccounts, getBalanceSheet, getOrganisation, getProfitAndLoss, getTrialBalance } from "@/lib/xero/endpoints";
import type { ParsedReport } from "@/lib/xero/parse-report";
import { periodsFor } from "./periods";
import { syncAppsInUse } from "@/lib/detect";
import { computeFlags } from "@/lib/signals/run";
import { detectInstalls, evaluateDue } from "@/lib/checkins";
import { peerBand, recordObservations } from "@/lib/prices";

export const STEPS = ["organisation", "accounts", "reports", "mapping", "statements", "apps", "cashflow", "flags"] as const;
type StepKey = (typeof STEPS)[number];

export type RefreshOpts = { client?: XeroClient; now?: Date };

/** A refresh is already running for this org (the sync_runs_one_running index refused a second one). */
export class RefreshBusyError extends Error {
  constructor() {
    super("A refresh is already running for this organisation.");
  }
}

/** Functions stop at 300s, so a run still marked running after this has died and must not block the org. */
export const ABANDONED_AFTER_MS = 5 * 60 * 1000;

const isUniqueViolation = (e: unknown) => {
  for (let x = e as { code?: string; cause?: unknown } | undefined; x; x = x.cause as typeof x) if (x.code === "23505") return true;
  return false;
};

export async function runRefresh(orgId: string, opts: RefreshOpts = {}) {
  const admin = await adminDb();
  await admin
    .update(syncRuns)
    .set({ status: "error", error: "Abandoned: stopped before finishing", finishedAt: new Date() })
    .where(and(eq(syncRuns.orgId, orgId), eq(syncRuns.status, "running"), lt(syncRuns.startedAt, new Date(Date.now() - ABANDONED_AFTER_MS))));
  let run: typeof syncRuns.$inferSelect | undefined;
  try {
    [run] = await admin
      .insert(syncRuns)
      .values({ orgId, steps: STEPS.map((key) => ({ key, status: "pending" as const })) })
      .returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw new RefreshBusyError();
    throw e;
  }
  const runId = run!.id;
  const steps: RunStep[] = run!.steps;
  const client = opts.client ?? (await clientForOrg(orgId));
  const now = opts.now ?? new Date();

  const save = () =>
    admin.update(syncRuns).set({ steps, calls: client.meter.calls, egressBytes: client.meter.bytes }).where(eq(syncRuns.id, runId));

  async function step<T>(key: StepKey, fn: () => Promise<T>): Promise<T> {
    const s = steps.find((x) => x.key === key)!;
    const calls0 = client.meter.calls;
    const bytes0 = client.meter.bytes;
    s.status = "running";
    await save();
    try {
      const out = await fn();
      Object.assign(s, { status: "ok", calls: client.meter.calls - calls0, bytes: client.meter.bytes - bytes0 });
      await save();
      return out;
    } catch (e) {
      Object.assign(s, { status: "error", error: errorText(e, 300) });
      await save();
      throw e;
    }
  }

  try {
    const xorg = await step("organisation", () => getOrganisation(client));
    const org = await withOrg(orgId, async (tx) => {
      const [o] = await tx
        .update(orgs)
        .set({ baseCurrency: xorg.BaseCurrency, country: xorg.CountryCode ?? null, fyEndMonth: xorg.FinancialYearEndMonth, fyEndDay: xorg.FinancialYearEndDay })
        .where(eq(orgs.id, orgId))
        .returning();
      if (!o) throw new Error("Org not found");
      return o;
    });
    const p = periodsFor(now, org);

    const xAccounts = await step("accounts", async () => {
      const list = await getAccounts(client);
      await withOrg(orgId, async (tx) => {
        for (const a of list) {
          const row = {
            orgId,
            xeroAccountId: a.AccountID,
            code: a.Code ?? null,
            name: a.Name,
            type: a.Type,
            class: a.Class ?? null,
            reportingCode: a.ReportingCode ?? null,
            reportingCodeName: a.ReportingCodeName ?? null,
            taxType: a.TaxType ?? null,
            systemAccount: a.SystemAccount ?? null,
            status: a.Status ?? null,
          };
          await tx.insert(accounts).values(row).onConflictDoUpdate({ target: [accounts.orgId, accounts.xeroAccountId], set: row });
        }
      });
      return list;
    });

    const reports = await step("reports", async () => {
      const [pl, bsClose, bsOpen, tb] = await Promise.all([
        getProfitAndLoss(client, new Date(p.from), new Date(p.to)),
        getBalanceSheet(client, new Date(p.to), "bs-close"),
        getBalanceSheet(client, new Date(p.priorFyEnd), "bs-open"),
        getTrialBalance(client, new Date(p.to)),
      ]);
      return { pl, bsClose, bsOpen, tb };
    });

    await step("mapping", async () => {
      const used = usedAccountIds(reports);
      const pending: QueueItem[] = [];
      await withOrg(orgId, async (tx) => {
        const existing = await tx.select().from(accountMaps);
        const confirmed = new Map(existing.filter((m) => m.source === "confirmed").map((m) => [m.xeroAccountId, m.category]));
        const { maps, unmapped } = await mapAccounts({
          accounts: xAccounts.map((a) => ({
            xeroAccountId: a.AccountID,
            code: a.Code,
            name: a.Name,
            type: a.Type,
            reportingCode: a.ReportingCode,
            taxType: a.TaxType,
            systemAccount: a.SystemAccount,
          })),
          categories: accountCategories(),
          catalog: mappingCatalog(),
          confirmed,
          minConfidence: env().MAP_CONFIDENCE_MIN,
        });
        for (const m of maps) {
          if (m.source === "rule" && confirmed.has(m.xeroAccountId)) continue;
          const row = { orgId, ...m, updatedAt: new Date() };
          await tx.insert(accountMaps).values(row).onConflictDoUpdate({ target: [accountMaps.orgId, accountMaps.xeroAccountId], set: row });
        }
        for (const a of unmapped) {
          if (!used.has(a.xeroAccountId)) continue; // unused accounts can't produce a flag; don't bother people
          pending.push({
            kind: "account_mapping",
            orgId,
            ref: { org_id: orgId, xero_account_id: a.xeroAccountId },
            reason: `Can't tell what "${a.name}"${a.code ? ` (${a.code})` : ""} is for (type ${a.type}).`,
          });
        }
      });
      await enqueueAll(pending);
    });

    await step("statements", async () => {
      await withOrg(orgId, async (tx) => {
        const info = await accountInfo(tx);
        const pl = buildPL(reports.pl, info, { from: p.from, to: p.to });
        const bs = buildBS(reports.bsClose, info, p.to);
        const bsOpen = buildBS(reports.bsOpen, info, p.priorFyEnd);
        for (const s of [pl, bs, bsOpen]) {
          if (s.checks.length) log.warn({ orgId, kind: s.kind, checks: s.checks }, "statement checks");
          await insertStatement(tx, orgId, runId, s);
        }
        const tbRows = reports.tb.rows
          .filter((r) => r.accountId)
          .map((r) => {
            const a = info.get(r.accountId!);
            return {
              orgId,
              runId,
              xeroAccountId: r.accountId!,
              code: a?.code ?? null,
              name: a?.name ?? r.label,
              ytdDebit: r.values[2] ?? 0,
              ytdCredit: r.values[3] ?? 0,
              asAt: p.to,
            };
          });
        if (tbRows.length) await tx.insert(trialBalance).values(tbRows);
      });
    });

    await step("apps", () => syncAppsInUse(orgId, client, { asAt: p.to }));

    await recompute(orgId, runId, { stepper: step });

    const status = steps.every((s) => s.status === "ok") ? "ok" : "partial";
    await admin.update(syncRuns).set({ status, finishedAt: new Date(), calls: client.meter.calls, egressBytes: client.meter.bytes }).where(eq(syncRuns.id, runId));
    return { runId, status };
  } catch (e) {
    await admin
      .update(syncRuns)
      .set({ status: "error", finishedAt: new Date(), error: errorText(e, 500), calls: client.meter.calls, egressBytes: client.meter.bytes })
      .where(eq(syncRuns.id, runId));
    throw e;
  }
}

type Stepper = <T>(key: StepKey, fn: () => Promise<T>) => Promise<T>;

/**
 * Recompute an org from stored rows: refresh line categories from account_maps, derive the cash flow,
 * then flags. Called at the end of a refresh, and after a review item that changes mapping is resolved.
 */
export async function recompute(orgId: string, runId?: string, opts: { stepper?: Stepper } = {}) {
  const step: Stepper = opts.stepper ?? ((_k, fn) => fn());
  const id = runId ?? (await latestRunId(orgId));
  if (!id) return { recomputed: false };

  await step("cashflow", async () => {
    const pending: QueueItem[] = [];
    let reconciledTo: string | null = null;
    await withOrg(orgId, async (tx) => {
      const info = await accountInfo(tx);
      const stmts = await tx.select().from(statements).where(eq(statements.runId, id));
      // Lines carry the category at the time of the refresh; bring them up to date.
      for (const s of stmts) {
        const lines = await tx.select().from(statementLines).where(eq(statementLines.statementId, s.id));
        for (const l of lines) {
          const cat = l.xeroAccountId ? (info.get(l.xeroAccountId)?.category ?? null) : l.category;
          if (cat !== l.category && l.xeroAccountId) {
            await tx
              .update(statementLines)
              .set({ category: cat })
              .where(and(eq(statementLines.statementId, s.id), eq(statementLines.lineKey, l.lineKey)));
          }
        }
      }
      const load = async (kind: "pl" | "bs", which: "latest" | "earliest" = "latest"): Promise<Statement | null> => {
        const cands = stmts.filter((s) => s.kind === kind).sort((a, b) => a.periodTo.localeCompare(b.periodTo));
        const s = which === "latest" ? cands.at(-1) : cands[0];
        if (!s || (which === "earliest" && cands.length < 2)) return null;
        const lines = await tx.select().from(statementLines).where(eq(statementLines.statementId, s.id));
        return {
          kind,
          periodFrom: s.periodFrom,
          periodTo: s.periodTo,
          derived: s.derived,
          totals: s.totals,
          checks: [],
          lines: lines.map(
            (l): StatementLine => ({
              lineKey: l.lineKey,
              xeroAccountId: l.xeroAccountId,
              code: l.code,
              name: l.name,
              section: l.section,
              category: l.xeroAccountId ? (info.get(l.xeroAccountId)?.category ?? null) : l.category,
              value: l.value,
              sort: l.sort,
            }),
          ),
        };
      };
      const pl = await load("pl");
      const close = await load("bs", "latest");
      const open = await load("bs", "earliest");
      if (!pl || !close || !open) return;

      const cf = deriveCashFlow({ pl, open, close, accounts: info, period: { from: pl.periodFrom!, to: pl.periodTo } });
      const old = stmts.filter((s) => s.kind === "cf").map((s) => s.id);
      if (old.length) await tx.delete(statements).where(inArray(statements.id, old));
      await insertStatement(tx, orgId, id, cf);
      if (cf.reconciled) reconciledTo = cf.periodTo;
      if (!cf.reconciled) {
        pending.push({
          kind: "cashflow_unreconciled",
          orgId,
          ref: { org_id: orgId, period_to: cf.periodTo },
          reason:
            `Cash flow doesn't reconcile yet: £${Math.abs(cf.totals.check).toFixed(2)} unexplained.` +
            (cf.unclassified.length ? ` Unclassified accounts: ${cf.unclassified.map((u) => `${u.name} (${u.type || "no type"})`).join(", ")}.` : ""),
        });
      }
    });
    await enqueueAll(pending);
    // The problem went away (e.g. a fix or a mapping change): close the open item for this period. Reopens if it returns.
    if (reconciledTo) await autoClose("cashflow_unreconciled", { org_id: orgId, period_to: reconciledTo }, `Reconciled on run ${id}`);
  });

  await step("flags", () => computeFlags(orgId, id));
  await afterInstall(orgId);
  return { recomputed: true, runId: id };
}

/**
 * After-install (CLAUDE.md §7.6): a recommended app that started billing becomes an install, peer price
 * observations are rewritten (opt-in only), and any check-in that's now due is judged from the figures we just
 * stored. Never fails the refresh.
 */
async function afterInstall(orgId: string) {
  try {
    await withOrg(orgId, async (tx) => {
      const [s] = await tx.select({ to: statements.periodTo }).from(statements).orderBy(desc(statements.periodTo)).limit(1);
      if (s) await detectInstalls(tx, orgId, s.to);
    });
    await recordObservations(orgId);
    await evaluateDue(orgId, { peer: peerBand });
  } catch (e) {
    log.error({ err: { message: errorText(e) }, orgId }, "after-install step failed");
  }
}

async function latestRunId(orgId: string): Promise<string | null> {
  return withOrg(orgId, async (tx) => {
    const [s] = await tx.select({ runId: statements.runId }).from(statements).orderBy(desc(statements.createdAt)).limit(1);
    return s?.runId ?? null;
  });
}

async function insertStatement(tx: Db, orgId: string, runId: string, s: Statement) {
  const [row] = await tx
    .insert(statements)
    .values({
      orgId,
      runId,
      kind: s.kind,
      periodFrom: s.periodFrom,
      periodTo: s.periodTo,
      derived: s.derived,
      reconciled: s.reconciled ?? null,
      reconDiff: s.reconDiff ?? null,
      totals: s.totals,
    })
    .returning({ id: statements.id });
  if (s.lines.length) {
    await tx.insert(statementLines).values(
      s.lines.map((l) => ({
        statementId: row!.id,
        orgId,
        lineKey: l.lineKey,
        xeroAccountId: l.xeroAccountId,
        code: l.code,
        name: l.name,
        section: l.section,
        category: l.category,
        value: l.value,
        sort: l.sort,
      })),
    );
  }
  return row!.id;
}

function usedAccountIds(r: { pl: ParsedReport; bsClose: ParsedReport; bsOpen: ParsedReport; tb: ParsedReport }) {
  const s = new Set<string>();
  for (const rep of [r.pl, r.bsClose, r.bsOpen, r.tb])
    for (const row of rep.rows) if (row.accountId && row.values.some((v) => v !== 0)) s.add(row.accountId);
  return s;
}
