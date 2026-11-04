import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { accounts, orgs, TENANT_TABLES } from "@/db/schema";
import { sql } from "drizzle-orm";
import { rowsOf } from "@/lib/db/rows";

let close: () => Promise<void>;
let a: string;
let b: string;

beforeAll(async () => {
  const h = await freshDb();
  close = h.close;
  const db = await adminDb();
  const [oa] = await db.insert(orgs).values({ name: "Org A" }).returning();
  const [ob] = await db.insert(orgs).values({ name: "Org B" }).returning();
  a = oa!.id;
  b = ob!.id;
  await db.insert(accounts).values([
    { orgId: a, xeroAccountId: crypto.randomUUID(), code: "200", name: "Sales", type: "REVENUE" },
    { orgId: b, xeroAccountId: crypto.randomUUID(), code: "477", name: "Wages", type: "EXPENSE" },
  ]);
});
afterAll(() => close());

describe("row-level security", () => {
  it("an org sees only its own rows", async () => {
    const rows = await withOrg(a, (tx) => tx.select().from(accounts));
    expect(rows.map((r) => r.name)).toEqual(["Sales"]);
  });

  it("a cross-org query returns zero rows", async () => {
    const rows = await withOrg(a, (tx) => tx.select().from(accounts).where(eq(accounts.orgId, b)));
    expect(rows).toHaveLength(0);
    const other = await withOrg(a, (tx) => tx.select().from(orgs).where(eq(orgs.id, b)));
    expect(other).toHaveLength(0);
  });

  it("cannot write into another org", async () => {
    await expect(
      withOrg(a, (tx) =>
        tx.insert(accounts).values({ orgId: b, xeroAccountId: crypto.randomUUID(), name: "x", type: "EXPENSE" }),
      ),
    ).rejects.toThrow();
  });

  it("RLS is enabled on every tenant table", async () => {
    const db = await adminDb();
    const res = await db.execute(sql`select relname from pg_class where relrowsecurity and relkind = 'r'`);
    const rows = rowsOf<{ relname: string }>(res);
    const on = new Set(rows.map((r) => r.relname));
    for (const t of TENANT_TABLES) expect(on.has(t), t).toBe(true);
  });

  it("the app role cannot read the review queue or users", async () => {
    await expect(withOrg(a, (tx) => tx.execute(sql`select * from review_queue`))).rejects.toThrow();
    await expect(withOrg(a, (tx) => tx.execute(sql`select * from users`))).rejects.toThrow();
  });
});
