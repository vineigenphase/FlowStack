/**
 * pnpm deploy:check — run with the target environment's variables (e.g. `vercel env pull .env.deploy` then
 * `DOTENV=.env.deploy pnpm deploy:check`). Checks settings, connects to the database, verifies the app role and RLS.
 */
import { loadEnvFiles } from "./_env";
if (process.env.DOTENV) loadEnvFiles([process.env.DOTENV]);
const { env, missingForDeploy } = await import("@/lib/env");
const { openDb } = await import("@/lib/db/client");
const { sql } = await import("drizzle-orm");
const { rowsOf } = await import("@/lib/db/rows");

let failed = false;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => {
  failed = true;
  console.log(`  FAIL  ${m}`);
};

console.log("settings");
const missing = missingForDeploy(env());
if (missing.length) missing.forEach((m) => bad(`missing or invalid: ${m}`));
else ok("all required settings present");
if (env().XERO_MODE !== "live") bad("XERO_MODE should be live in a deployed environment");
if (!env().ADMIN_EMAILS) bad("ADMIN_EMAILS is empty — nobody can work the review queue");

console.log("database");
if (env().DATABASE_URL) {
  const h = await openDb(env().DATABASE_URL);
  try {
    const roles = rowsOf<{ ok: boolean }>(await h.db.execute(sql`select exists(select 1 from pg_roles where rolname = 'flowstack_app') as ok`));
    if (roles[0]?.ok) ok("flowstack_app role exists");
    else bad("flowstack_app role missing — run pnpm db:migrate");
    const rls = rowsOf<{ n: number }>(await h.db.execute(sql`select count(*)::int as n from pg_class where relrowsecurity and relkind = 'r'`));
    if ((rls[0]?.n ?? 0) >= 19) ok(`RLS on ${rls[0]!.n} tables`);
    else bad(`RLS on only ${rls[0]?.n ?? 0} tables`);
    const can = rowsOf<{ ok: boolean }>(await h.db.execute(sql`select pg_has_role(current_user, 'flowstack_app', 'MEMBER') as ok`));
    if (can[0]?.ok) ok("connection role can SET ROLE flowstack_app");
    else bad("connection role is not a member of flowstack_app");
  } catch (e) {
    bad(`database check failed: ${(e as Error).message}`);
  } finally {
    await h.close();
  }
}
console.log(failed ? "\nNot ready to deploy." : "\nReady.");
process.exit(failed ? 1 : 0);
