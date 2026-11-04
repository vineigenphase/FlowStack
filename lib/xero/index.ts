import { and, eq } from "drizzle-orm";
import { xeroConnections } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { FixtureXeroClient, LiveXeroClient, type XeroClient } from "./client";
import { getAccessToken } from "./tokens";

/** The right client for an org: fixtures in XERO_MODE=fixtures, otherwise its active connection. */
export async function clientForOrg(orgId: string, fixtureSet?: string): Promise<XeroClient> {
  const e = env();
  if (e.XERO_MODE === "fixtures" || fixtureSet) return new FixtureXeroClient(fixtureSet ?? e.XERO_FIXTURE_SET, orgId);
  const db = await adminDb();
  const [c] = await db
    .select({ id: xeroConnections.id, tenantId: xeroConnections.tenantId })
    .from(xeroConnections)
    .where(and(eq(xeroConnections.orgId, orgId), eq(xeroConnections.status, "active")));
  if (!c) throw new Error("No active Xero connection for this org");
  return new LiveXeroClient({ tenantId: c.tenantId, orgKey: orgId, token: (force) => getAccessToken(c.id, { force }) });
}
