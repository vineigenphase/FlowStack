/**
 * The signed-in user across businesses (BACKEND.md §3.5, v1.1 A + I).
 * - A user belongs to many orgs through org_members; accountants and groups switch between them.
 * - job_title is asked once, to see who actually connects. It changes no permissions.
 */
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { orgMembers, orgs, users, xeroConnections } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { summaryView } from "@/lib/read/views";

export const JOB_TITLES = [
  { key: "finance_director", label: "Finance director or CFO" },
  { key: "financial_controller", label: "Financial controller" },
  { key: "finance_manager", label: "Finance manager" },
  { key: "head_of_finance", label: "Head of finance" },
  { key: "accountant", label: "Accountant or adviser" },
  { key: "bookkeeper", label: "Bookkeeper" },
  { key: "owner", label: "Owner or managing director" },
  { key: "other", label: "Something else" },
  /** Asked once, so a skip is remembered too. */
  { key: "not_given", label: "Rather not say" },
] as const;
export const JobTitle = z.enum(JOB_TITLES.map((j) => j.key) as [string, ...string[]]);

export async function getMe(userId: string) {
  const db = await adminDb();
  const [u] = await db.select({ id: users.id, email: users.email, name: users.name, jobTitle: users.jobTitle }).from(users).where(eq(users.id, userId));
  return u ?? null;
}

export async function setJobTitle(userId: string, jobTitle: string) {
  const db = await adminDb();
  await db.update(users).set({ jobTitle: JobTitle.parse(jobTitle) }).where(eq(users.id, userId));
}

/** The user's businesses for the switcher: name, last refresh, £ at stake. */
export async function myOrgs(userId: string) {
  const db = await adminDb();
  const rows = await db
    .select({ id: orgs.id, name: orgs.name, sample: orgs.sample, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(orgs.name);
  return Promise.all(
    rows.map(async (o) => {
      const s = await summaryView(o.id);
      const run = s?.lastRun ?? null;
      return {
        ...o,
        lastRefresh: run ? { status: run.status, finishedAt: run.finishedAt ?? null } : null,
        atStake: s && "atStake" in s && s.atStake ? s.atStake.value : null,
      };
    }),
  );
}

export async function isMember(userId: string, orgId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return false;
  const db = await adminDb();
  const [m] = await db.select({ r: orgMembers.role }).from(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  return Boolean(m);
}

/** Active Xero connections against the plan's cap (Starter 5, Core 50: BACKEND §3.5). Counts every business on our app. */
export async function connectionUse() {
  const db = await adminDb();
  const [r] = await db.select({ n: count() }).from(xeroConnections).where(ne(xeroConnections.status, "revoked"));
  const used = Number(r?.n ?? 0);
  const cap = env().XERO_CONNECTION_CAP;
  return { used, cap, full: used >= cap };
}
