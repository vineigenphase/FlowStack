import { openDb, migrateDb, setDbForTests } from "@/lib/db/client";

/** Fresh in-memory Postgres with all migrations applied, installed as the app's database. */
export async function freshDb() {
  const h = await openDb("memory://");
  await migrateDb(h);
  setDbForTests(h);
  return h;
}
