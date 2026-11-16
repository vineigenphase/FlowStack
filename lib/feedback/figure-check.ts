/**
 * "The amount isn't what our Xero shows" (round-2 3b): re-fetch that report from Xero straight away and compare
 * the line with the figure we hold. Read-only, one Xero call. Profit and loss and balance sheet lines only (the
 * cash flow is derived, trends are computed).
 */
import { and, eq } from "drizzle-orm";
import { flags, statements } from "@/db/schema";
import { withOrg } from "@/lib/db/client";
import { accountInfo } from "@/lib/statements/accounts";
import { buildBS, buildPL } from "@/lib/statements/build";
import { clientForOrg } from "@/lib/xero";
import type { XeroClient } from "@/lib/xero/client";
import { getBalanceSheet, getProfitAndLoss } from "@/lib/xero/endpoints";
import { errorText } from "@/lib/sync/error-text";

export type FigureCheck =
  | { status: "same"; ours: number; xero: number }
  | { status: "different"; ours: number; xero: number }
  | { status: "missing"; ours: number } // the line isn't in Xero's report any more
  | { status: "not_checked"; reason: string };

export async function checkFigure(orgId: string, flagId: string, deps: { client?: XeroClient } = {}): Promise<FigureCheck> {
  const ctx = await withOrg(orgId, async (tx) => {
    const [f] = await tx.select().from(flags).where(eq(flags.id, flagId));
    if (!f || (f.statementKind !== "pl" && f.statementKind !== "bs")) return null;
    const ss = await tx.select().from(statements).where(and(eq(statements.runId, f.runId), eq(statements.kind, f.statementKind)));
    const s = ss.sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0];
    if (!s) return null;
    return { f, s, info: await accountInfo(tx) };
  });
  if (!ctx) return { status: "not_checked", reason: "only profit and loss and balance sheet lines are re-fetched" };
  const { f, s, info } = ctx;
  try {
    const client = deps.client ?? (await clientForOrg(orgId));
    const fresh =
      f.statementKind === "pl"
        ? buildPL(await getProfitAndLoss(client, new Date(s.periodFrom! + "T00:00:00Z"), new Date(s.periodTo + "T00:00:00Z")), info, { from: s.periodFrom!, to: s.periodTo })
        : buildBS(await getBalanceSheet(client, new Date(s.periodTo + "T00:00:00Z"), "bs-close"), info, s.periodTo);
    const line = fresh.lines.find((l) => l.lineKey === f.lineKey);
    if (!line) return { status: "missing", ours: f.value };
    return Math.abs(line.value - f.value) < 0.005 ? { status: "same", ours: f.value, xero: line.value } : { status: "different", ours: f.value, xero: line.value };
  } catch (e) {
    return { status: "not_checked", reason: `Xero didn't answer (${errorText(e, 120)})` };
  }
}

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the user is told, and what our team gets. */
export function figureOutcome(c: FigureCheck, lineKey: string): { message: string; reason: string; priority: "high" | "normal" } {
  if (c.status === "different" || c.status === "missing") {
    const now = c.status === "different" ? gbp(c.xero) : "nothing (the line is no longer in the report)";
    return {
      message: "Thanks. Xero now shows a different figure from the one we hold, so we've flagged it to our team. Press Refresh from Xero to update your figures.",
      reason: `Figure mismatch on ${lineKey}: Xero now shows ${now}, we hold ${gbp(c.ours)}. Re-fetched just now; the business says the amount is wrong.`,
      priority: "high",
    };
  }
  if (c.status === "same") {
    return {
      message: "Thanks. We re-checked with Xero just now and it still shows the figure we hold. Our team will look at why yours differs.",
      reason: `"The amount isn't what our Xero shows" on ${lineKey}: re-fetched, Xero still shows ${gbp(c.xero)} (same as ours). Check the period or account with the business.`,
      priority: "normal",
    };
  }
  return {
    message: "Thanks. We're checking this line. It shows as Checking until we have.",
    reason: `"The amount isn't what our Xero shows" on ${lineKey}: not re-fetched (${c.reason}).`,
    priority: "normal",
  };
}
