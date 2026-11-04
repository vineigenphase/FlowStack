import path from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";

/** Any Drizzle handle (database or transaction) over our schema. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");

type Handle = { db: Db; close: () => Promise<void>; kind: "pglite" | "postgres" };

let owner: Promise<Handle> | null = null;

/**
 * Open a database. Empty DATABASE_URL → embedded Postgres (PGlite) on disk, so dev mode
 * needs no Docker. `memory://` → in-memory PGlite (tests). Anything else → postgres-js (Docker, Neon).
 */
export async function openDb(url: string): Promise<Handle> {
  if (!url || url.startsWith("memory://") || url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dataDir = url.startsWith("memory://") ? undefined : url.replace(/^pglite:/, "") || env().PGLITE_DIR;
    const client = dataDir ? new PGlite(dataDir) : new PGlite();
    const db = drizzle(client, { schema }) as unknown as Db;
    return { db, kind: "pglite", close: () => client.close() };
  }
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, { max: 5, prepare: false });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, kind: "postgres", close: () => client.end() };
}

export async function migrateDb(h: Handle) {
  if (h.kind === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(h.db as any, { migrationsFolder: MIGRATIONS });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(h.db as any, { migrationsFolder: MIGRATIONS });
  }
}

/** The owner connection. Bypasses RLS (table owner) — use only for admin, queue and system jobs. */
export async function adminDb(): Promise<Db> {
  if (!owner) {
    const e = env();
    owner = openDb(e.DATABASE_ADMIN_URL || e.DATABASE_URL);
  }
  return (await owner).db;
}

/** Tests: swap in a fresh database (e.g. memory://). */
export function setDbForTests(h: Handle | null) {
  owner = h ? Promise.resolve(h) : null;
}

/**
 * Run `fn` scoped to one org. Inside the transaction we set app.org_id and drop to the
 * flowstack_app role, so RLS policies apply even though the connection is the owner.
 */
export async function withOrg<T>(orgId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  const db = await adminDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    await tx.execute(sql`set local role flowstack_app`);
    return fn(tx as unknown as Db);
  }) as Promise<T>;
}

export async function pingDb(): Promise<boolean> {
  const db = await adminDb();
  await db.execute(sql`select 1`);
  return true;
}
