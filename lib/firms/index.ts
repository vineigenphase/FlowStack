/**
 * Practice plan (CLAUDE.md §1 "Who pays" + "Firm UX"; BACKEND.md §18 "Firm plan").
 *
 * Firm tables live on the owner connection and are only read after a membership check here. Each client's own
 * figures are still read through withOrg (RLS), one org at a time. Clients are added one connection at a time
 * (Xero Bulk Connections is Advanced-plan only), and only by someone who is a member of that client org.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  auditLog,
  checkins,
  detectedApps,
  firmInvites,
  firmMembers,
  firmOrgs,
  firms,
  installs,
  orgMembers,
  orgs,
  playbooks,
  proposals,
  type ProposalItem,
} from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { HttpError } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { appCategories, apps as catalogApps } from "@/lib/catalog/load";
import { stackMapView } from "@/lib/read/views";
import { driftFor, flowSegments, type Drift } from "./flow";

const token = () => randomBytes(24).toString("base64url");
const DAY = 86_400_000;
export const INVITE_DAYS = 14;
export const PROPOSAL_DAYS = 30;
const appName = (id: string) => catalogApps().find((a) => a.id === id)?.name ?? id;
const jobLabel = (k: string) => appCategories().find((c) => c.key === k)?.label ?? k;

async function audit(actor: string, action: string, target: Record<string, unknown>) {
  const db = await adminDb();
  await db.insert(auditLog).values({ actor, action, target });
}

// ---------- firms and members ----------

export async function createFirm(userId: string, name: string) {
  const db = await adminDb();
  const [f] = await db.insert(firms).values({ name }).returning();
  await db.insert(firmMembers).values({ firmId: f!.id, userId, role: "owner" });
  await audit(userId, "firm.created", { firm_id: f!.id });
  return f!;
}

export async function myFirms(userId: string) {
  const db = await adminDb();
  return db
    .select({ id: firms.id, name: firms.name, role: firmMembers.role })
    .from(firmMembers)
    .innerJoin(firms, eq(firms.id, firmMembers.firmId))
    .where(eq(firmMembers.userId, userId))
    .orderBy(firms.name);
}

/** The signed-in user must belong to this firm. */
export async function requireFirmMember(firmId: string) {
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(firmId)) throw new HttpError(404, "Practice not found");
  const db = await adminDb();
  const [m] = await db
    .select({ role: firmMembers.role, name: firms.name })
    .from(firmMembers)
    .innerJoin(firms, eq(firms.id, firmMembers.firmId))
    .where(and(eq(firmMembers.firmId, firmId), eq(firmMembers.userId, u.userId)));
  if (!m) throw new HttpError(404, "Practice not found");
  return { ...u, firmRole: m.role, firmName: m.name };
}

export async function createInvite(firmId: string, userId: string) {
  const db = await adminDb();
  const [i] = await db.insert(firmInvites).values({ token: token(), firmId, createdBy: userId, expiresAt: new Date(Date.now() + INVITE_DAYS * DAY) }).returning();
  await audit(userId, "firm.invite_created", { firm_id: firmId });
  return i!;
}

export async function joinFirm(tok: string, userId: string) {
  const db = await adminDb();
  const [i] = await db
    .update(firmInvites)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(and(eq(firmInvites.token, tok), isNull(firmInvites.usedBy), gt(firmInvites.expiresAt, new Date())))
    .returning();
  if (!i) throw new HttpError(410, "This invite has been used or has expired. Ask for a new one.");
  await db.insert(firmMembers).values({ firmId: i.firmId, userId, role: "member" }).onConflictDoNothing();
  await audit(userId, "firm.joined", { firm_id: i.firmId });
  return i.firmId;
}

export async function firmMembersList(firmId: string) {
  const db = await adminDb();
  const { users } = await import("@/db/schema");
  return db
    .select({ userId: firmMembers.userId, role: firmMembers.role, email: users.email, name: users.name })
    .from(firmMembers)
    .innerJoin(users, eq(users.id, firmMembers.userId))
    .where(eq(firmMembers.firmId, firmId));
}

// ---------- clients ----------

/** Add a client the user is a member of (they connected its Xero). */
export async function addClient(firmId: string, userId: string, orgId: string) {
  const db = await adminDb();
  const [m] = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  if (!m) throw new HttpError(403, "Connect this client's Xero yourself first, then add it.");
  await db.insert(firmOrgs).values({ firmId, orgId, addedBy: userId }).onConflictDoNothing();
  await audit(userId, "firm.client_added", { firm_id: firmId, org_id: orgId });
}

export async function removeClient(firmId: string, userId: string, orgId: string) {
  const db = await adminDb();
  await db.delete(firmOrgs).where(and(eq(firmOrgs.firmId, firmId), eq(firmOrgs.orgId, orgId)));
  await audit(userId, "firm.client_removed", { firm_id: firmId, org_id: orgId });
}

/** The user's own orgs that aren't clients of this firm yet. */
export async function addableOrgs(firmId: string, userId: string) {
  const db = await adminDb();
  const mine = await db.select({ id: orgs.id, name: orgs.name, sample: orgs.sample }).from(orgMembers).innerJoin(orgs, eq(orgs.id, orgMembers.orgId)).where(eq(orgMembers.userId, userId));
  const have = new Set((await db.select({ orgId: firmOrgs.orgId }).from(firmOrgs).where(eq(firmOrgs.firmId, firmId))).map((r) => r.orgId));
  return mine.filter((o) => !have.has(o.id));
}

export type ClientRow = {
  orgId: string;
  name: string;
  sample: boolean;
  industry: string | null;
  ready: boolean;
  atStake: number;
  fixes: number;
  segments: ReturnType<typeof flowSegments>;
  proposal: { id: string; status: string; sentAt: Date | null } | null;
  watching: number;
  failedChecks: number;
  drift: (Drift & { jobLabel: string; wantName: string; haveNames: string[] })[];
  tags: ("fixes_ready" | "proposal_out" | "watching")[];
};

/** Practice home: every client, ranked by £ at stake (hours need transaction volumes: out of 1.0, BACKEND D7). */
export async function clientsView(firmId: string): Promise<ClientRow[]> {
  const db = await adminDb();
  const rows = await db
    .select({ orgId: orgs.id, name: orgs.name, sample: orgs.sample, industry: orgs.industry })
    .from(firmOrgs)
    .innerJoin(orgs, eq(orgs.id, firmOrgs.orgId))
    .where(eq(firmOrgs.firmId, firmId));
  const pb = await db.select().from(playbooks).where(eq(playbooks.firmId, firmId));
  const props = rows.length
    ? await db.select().from(proposals).where(and(eq(proposals.firmId, firmId), inArray(proposals.orgId, rows.map((r) => r.orgId)))).orderBy(desc(proposals.createdAt))
    : [];

  const out: ClientRow[] = [];
  for (const r of rows) {
    const map = await stackMapView(r.orgId);
    const { pending, failed, det } = await withOrg(r.orgId, async (tx) => {
      const cs = await tx.select({ status: checkins.status }).from(checkins).innerJoin(installs, eq(installs.id, checkins.installId)).where(eq(installs.status, "active"));
      return {
        pending: cs.filter((c) => c.status === "pending").length,
        failed: cs.filter((c) => c.status === "failed").length,
        det: await tx.select({ appId: detectedApps.appId, present: detectedApps.present }).from(detectedApps),
      };
    });
    const inUseByJob = new Map<string, string[]>();
    for (const d of det.filter((x) => x.present)) {
      for (const c of catalogApps().find((a) => a.id === d.appId)?.categories ?? []) inUseByJob.set(c, [...(inUseByJob.get(c) ?? []), d.appId]);
    }
    const drift = r.industry
      ? driftFor(pb.filter((p) => p.industry === r.industry), inUseByJob).map((d) => ({ ...d, jobLabel: jobLabel(d.job), wantName: appName(d.want), haveNames: d.have.map(appName) }))
      : [];
    const p = props.find((x) => x.orgId === r.orgId && x.status !== "withdrawn") ?? null;
    const atStake = map ? map.functions.reduce((s, f) => s + f.atStake, 0) : 0;
    const fixes = map?.fixes.length ?? 0;
    const tags: ClientRow["tags"] = [];
    if (fixes && (!p || p.status === "draft")) tags.push("fixes_ready");
    if (p?.status === "sent") tags.push("proposal_out");
    if (pending) tags.push("watching");
    out.push({
      ...r,
      ready: Boolean(map),
      atStake,
      fixes,
      segments: map ? flowSegments(map.functions) : [],
      proposal: p ? { id: p.id, status: p.status, sentAt: p.sentAt } : null,
      watching: pending,
      failedChecks: failed,
      drift,
      tags,
    });
  }
  return out.sort((a, b) => b.atStake - a.atStake || a.name.localeCompare(b.name));
}

// ---------- playbooks ----------

export async function getPlaybooks(firmId: string) {
  const db = await adminDb();
  return db.select().from(playbooks).where(eq(playbooks.firmId, firmId));
}

/** Set (or clear, with appId null) the playbook app for one job in one industry. */
export async function setPlaybook(firmId: string, userId: string, industry: string, jobKey: string, appId: string | null) {
  if (!appCategories().some((c) => c.key === jobKey)) throw new HttpError(422, "Unknown finance job");
  const db = await adminDb();
  if (!appId) {
    await db.delete(playbooks).where(and(eq(playbooks.firmId, firmId), eq(playbooks.industry, industry), eq(playbooks.jobKey, jobKey)));
  } else {
    const app = catalogApps().find((a) => a.id === appId);
    if (!app || !app.categories.includes(jobKey)) throw new HttpError(422, "That app doesn't do this job in our catalogue");
    await db
      .insert(playbooks)
      .values({ firmId, industry, jobKey, appId })
      .onConflictDoUpdate({ target: [playbooks.firmId, playbooks.industry, playbooks.jobKey], set: { appId } });
  }
  await audit(userId, "firm.playbook_set", { firm_id: firmId, industry, job: jobKey, app_id: appId });
}

// ---------- proposals ----------

async function requireClient(firmId: string, orgId: string) {
  const db = await adminDb();
  const [c] = await db.select().from(firmOrgs).where(and(eq(firmOrgs.firmId, firmId), eq(firmOrgs.orgId, orgId)));
  if (!c) throw new HttpError(404, "Client not found in this practice");
}

/** Draft a proposal from the client's numbered fixes (the stack map order: fixes before adds). */
export async function createProposal(firmId: string, orgId: string, userId: string, feeText: string | null) {
  await requireClient(firmId, orgId);
  const map = await stackMapView(orgId);
  if (!map?.fixes.length) throw new HttpError(422, "No fixes for this client yet. Refresh their figures first.");
  const lineName = new Map(map.functions.flatMap((f) => f.lines.map((l) => [l.key, l.code ? `${l.code} ${l.name}` : l.name] as const)));
  const items: ProposalItem[] = map.fixes.map((x) => ({ n: x.n, kind: x.kind, fn: x.fnLabel, title: x.title, why: x.why, atStake: x.atStake, lines: x.lineKeys.map((k) => lineName.get(k) ?? k) }));
  const db = await adminDb();
  const [p] = await db.insert(proposals).values({ firmId, orgId, token: token(), items, chosen: items.map((i) => i.n), feeText, createdBy: userId }).returning();
  await audit(userId, "proposal.created", { firm_id: firmId, org_id: orgId, proposal_id: p!.id });
  return p!;
}

export async function updateProposal(firmId: string, id: string, userId: string, patch: { feeText?: string | null; status?: "sent" | "withdrawn" }) {
  const db = await adminDb();
  const [p] = await db.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.firmId, firmId)));
  if (!p) throw new HttpError(404, "Proposal not found");
  if (p.status === "accepted" && patch.status) throw new HttpError(409, "The client has already answered this proposal");
  const set: Partial<typeof proposals.$inferInsert> = {};
  if (patch.feeText !== undefined) set.feeText = patch.feeText;
  if (patch.status === "sent") Object.assign(set, { status: "sent", sentAt: new Date(), expiresAt: new Date(Date.now() + PROPOSAL_DAYS * DAY) });
  if (patch.status === "withdrawn") set.status = "withdrawn";
  const [row] = await db.update(proposals).set(set).where(eq(proposals.id, id)).returning();
  await audit(userId, `proposal.${patch.status ?? "edited"}`, { firm_id: firmId, proposal_id: id });
  return row!;
}

export async function firmProposals(firmId: string) {
  const db = await adminDb();
  return db
    .select({ p: proposals, orgName: orgs.name })
    .from(proposals)
    .innerJoin(orgs, eq(orgs.id, proposals.orgId))
    .where(eq(proposals.firmId, firmId))
    .orderBy(desc(proposals.createdAt));
}

/** Public, by link: only sent (or answered) proposals that haven't expired. */
export async function proposalByToken(tok: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(tok)) return null;
  const db = await adminDb();
  const [row] = await db
    .select({ p: proposals, firmName: firms.name, orgName: orgs.name, sample: orgs.sample })
    .from(proposals)
    .innerJoin(firms, eq(firms.id, proposals.firmId))
    .innerJoin(orgs, eq(orgs.id, proposals.orgId))
    .where(eq(proposals.token, tok));
  if (!row || (row.p.status !== "sent" && row.p.status !== "accepted")) return null;
  if (row.p.expiresAt && row.p.expiresAt.getTime() < Date.now() && row.p.status === "sent") return null;
  return row;
}

/** The client ticks the fixes they want and accepts. */
export async function respondToProposal(tok: string, chosen: number[]) {
  const row = await proposalByToken(tok);
  if (!row) throw new HttpError(404, "This proposal link has expired or been withdrawn");
  if (row.p.status === "accepted") throw new HttpError(409, "You've already answered this proposal");
  const valid = new Set(row.p.items.map((i) => i.n));
  const pick = [...new Set(chosen)].filter((n) => valid.has(n)).sort((a, b) => a - b);
  if (!pick.length) throw new HttpError(422, "Tick at least one fix");
  const db = await adminDb();
  const [p] = await db.update(proposals).set({ chosen: pick, status: "accepted", respondedAt: new Date() }).where(eq(proposals.id, row.p.id)).returning();
  await audit("client", "proposal.accepted", { proposal_id: row.p.id, chosen: pick });
  return p!;
}

// ---------- Monday digest ----------

/** Wins, clients that need the partner, proposals waiting. A page for now; email/Slack delivery needs a provider. */
export async function digest(firmId: string, now = new Date()) {
  const clients = await clientsView(firmId);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const wins: { org: string; name: string; text: string }[] = [];
  for (const c of clients) {
    const ok = await withOrg(c.orgId, (tx) =>
      tx
        .select({ appId: installs.appId, kind: checkins.kind, result: checkins.result, at: checkins.checkedAt })
        .from(checkins)
        .innerJoin(installs, eq(installs.id, checkins.installId))
        .where(and(eq(checkins.status, "ok"), gt(checkins.checkedAt, weekAgo))),
    );
    for (const k of ok) wins.push({ org: c.orgId, name: c.name, text: k.result?.headline ?? `${appName(k.appId)} passed its ${k.kind} check` });
  }
  const props = await firmProposals(firmId);
  return {
    wins,
    needPartner: clients.filter((c) => c.failedChecks > 0 || (c.atStake > 0 && !c.proposal) || c.drift.length > 0),
    waiting: props.filter((x) => x.p.status === "sent"),
    acceptedThisWeek: props.filter((x) => x.p.status === "accepted" && x.p.respondedAt && x.p.respondedAt > weekAgo),
    clients,
  };
}
