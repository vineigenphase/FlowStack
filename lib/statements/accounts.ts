import { and, eq } from "drizzle-orm";
import { accountMaps, accounts } from "@/db/schema";
import type { Db } from "@/lib/db/client";
import { UNMAPPED } from "@/lib/mapping";
import type { AcctInfo } from "./build";

/** Chart of accounts joined to the current mapping, keyed by Xero AccountID. */
export async function accountInfo(tx: Db): Promise<Map<string, AcctInfo>> {
  const rows = await tx
    .select({
      xeroAccountId: accounts.xeroAccountId,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      systemAccount: accounts.systemAccount,
      category: accountMaps.category,
    })
    .from(accounts)
    .leftJoin(accountMaps, and(eq(accountMaps.orgId, accounts.orgId), eq(accountMaps.xeroAccountId, accounts.xeroAccountId)));
  return new Map(rows.map((r) => [r.xeroAccountId, { ...r, category: r.category === UNMAPPED ? UNMAPPED : (r.category ?? null) }]));
}
