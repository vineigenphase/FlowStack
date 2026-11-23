/** ENGINE-V2 §2.3: the lines the Engine panel can show for a business (latest refresh, flagged or covered, largest £ first). */
import { desc, eq, inArray } from "drizzle-orm";
import { flags, statementLines, statements } from "@/db/schema";
import { withOrg } from "@/lib/db/client";

export type PanelLine = { lineKey: string; name: string; value: number; state: string; ruleId: string | null };

export async function panelLines(orgId: string): Promise<PanelLine[]> {
  return withOrg(orgId, async (tx) => {
    const [latest] = await tx.select({ runId: statements.runId }).from(statements).orderBy(desc(statements.createdAt)).limit(1);
    if (!latest) return [];
    const fs = (await tx.select().from(flags).where(eq(flags.runId, latest.runId))).filter((f) => f.state === "flagged" || f.state === "covered");
    const stmtIds = (await tx.select({ id: statements.id }).from(statements).where(eq(statements.runId, latest.runId))).map((s) => s.id);
    const names = new Map(
      (stmtIds.length ? await tx.select({ lineKey: statementLines.lineKey, name: statementLines.name }).from(statementLines).where(inArray(statementLines.statementId, stmtIds)) : []).map((l) => [l.lineKey, l.name]),
    );
    return fs
      .map((f) => ({ lineKey: f.lineKey, name: names.get(f.lineKey) ?? f.lineKey, value: f.value, state: f.state, ruleId: f.ruleId }))
      .sort((a, b) => Number(b.state === "flagged") - Number(a.state === "flagged") || Math.abs(b.value) - Math.abs(a.value));
  });
}
