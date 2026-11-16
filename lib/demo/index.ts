/**
 * Read-only demo (NEXT-STEPS P0.2). `/demo` gives a visitor a 24-hour guest session on one sample business, for
 * the designer and for sales. A guest:
 *  - can read only that business (readerFor), never a real one;
 *  - can't write settings, connect Xero, bill or answer as a real user (every write route needs a signed-in member);
 *  - can try "Is this right?" and the shortlist: kept in guest_actions for 24 hours, never in flag_feedback or
 *    shortlist, so nothing reaches the shared org, the false-positive report or any metric.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { guestActions, orgs, statements } from "@/db/schema";
import { adminDb, withOrg } from "@/lib/db/client";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/api";
import { messageFor, SUB_REASONS, type Answer, type SubReason } from "@/lib/feedback";

export const GUEST_TTL_MS = 24 * 3_600_000;
/** The built-in demo business: the ecommerce sample (fixtures only, labelled sample). Fixed id so every instance agrees. */
export const DEMO_ORG_UUID = "00000000-0000-4000-8000-00000000d3e0";
export const DEMO_ORG_NAME = "Northwind Goods Ltd (sample)";
const DEMO_FIXTURES = "demo-uk-ecommerce";

export const demoEnabled = () => env().DEMO_ENABLED;
export const demoOrgId = () => env().DEMO_ORG_ID || DEMO_ORG_UUID;

/**
 * The demo business, created from fixtures on first use (runs the real pipeline, no Xero calls).
 * A configured DEMO_ORG_ID must be a sample org: /demo never opens a real business.
 */
export async function ensureDemoOrg(now = new Date()): Promise<string> {
  const id = demoOrgId();
  const db = await adminDb();
  const [o] = await db.select({ id: orgs.id, sample: orgs.sample }).from(orgs).where(eq(orgs.id, id));
  if (o && !o.sample) throw new HttpError(500, "DEMO_ORG_ID points at a real business; /demo only opens sample ones");
  if (!o) {
    if (id !== DEMO_ORG_UUID) throw new HttpError(404, "DEMO_ORG_ID not found");
    const created = await db
      .insert(orgs)
      .values({ id, name: DEMO_ORG_NAME, sample: true, industry: "ecommerce", markets: ["UK"] })
      .onConflictDoNothing()
      .returning({ id: orgs.id });
    if (!created.length) return id; // another request is building it
  }
  const [s] = await withOrg(id, (tx) => tx.select({ id: statements.id }).from(statements).limit(1));
  if (!s) {
    const { runRefresh, RefreshBusyError } = await import("@/lib/sync/refresh");
    const { FixtureXeroClient } = await import("@/lib/xero/client");
    try {
      await runRefresh(id, { client: new FixtureXeroClient(DEMO_FIXTURES, id), now });
    } catch (e) {
      if (!(e instanceof RefreshBusyError)) throw e;
    }
  }
  return id;
}

// ---------- guest session ----------

export type GuestSession = { guestId?: string; guestOrgId?: string; guestUntil?: number };
export type Reader = { userId: string | null; guestId: string | null; guest: boolean; role: string };

/**
 * Who may read `orgId` (pure, for tests): a signed-in member (checked by the caller) or a guest whose session is
 * for this org and hasn't expired. Anything else is a 401 (no session) or 404 (wrong org, never says which exists).
 */
export function guestReader(s: GuestSession, orgId: string, now = Date.now()): Reader {
  if (!s.guestId || !s.guestOrgId) throw new HttpError(401, "Sign in with Xero first");
  if (!s.guestUntil || s.guestUntil < now) throw new HttpError(401, "Your demo session has ended. Open /demo again.");
  if (s.guestOrgId !== orgId) throw new HttpError(404, "Org not found");
  return { userId: null, guestId: s.guestId, guest: true, role: "guest" };
}

export function newGuest(orgId: string, now = Date.now()): Required<GuestSession> {
  return { guestId: randomUUID(), guestOrgId: orgId, guestUntil: now + GUEST_TTL_MS };
}

// ---------- what a guest did ----------

const STATE_AFTER: Record<Answer, string | null> = { yes: null, already_use_app: "covered", no_app_needed: "marked_fine", numbers_wrong: "queued", not_now: "snoozed" };

export async function guestFeedback(
  guestId: string,
  orgId: string,
  flagId: string,
  input: { answer: Answer | "no"; subReason?: SubReason; appId?: string; appName?: string; note?: string },
  now = new Date(),
) {
  const answer: Answer = input.answer === "no" ? "no_app_needed" : input.answer;
  if (input.subReason && !SUB_REASONS.includes(input.subReason)) throw new HttpError(422, "Unknown sub-reason");
  const db = await adminDb();
  await db.insert(guestActions).values({ guestId, orgId, kind: "feedback", flagId, payload: { ...input, answer }, createdAt: now });
  return { flagId, answer, state: answer === "numbers_wrong" && input.subReason === "one_off" ? "marked_fine" : STATE_AFTER[answer], message: `${messageFor(answer, input.appName ?? input.appId ?? null, Boolean(input.appId), now)} (Demo: kept for 24 hours, nobody else sees it.)`, guest: true };
}

export async function undoGuestFeedback(guestId: string, flagId: string) {
  const db = await adminDb();
  const [last] = await db
    .select({ id: guestActions.id })
    .from(guestActions)
    .where(and(eq(guestActions.guestId, guestId), eq(guestActions.kind, "feedback"), eq(guestActions.flagId, flagId)))
    .orderBy(desc(guestActions.createdAt))
    .limit(1);
  if (!last) throw new HttpError(404, "No answer to undo");
  await db.delete(guestActions).where(eq(guestActions.id, last.id));
  return { flagId, state: null, message: "Answer removed." };
}

/** The guest's latest answer per flag, within the last 24 hours. */
export async function guestAnswers(guestId: string, now = new Date()): Promise<Map<string, { answer: Answer; subReason?: SubReason; state: string | null }>> {
  const db = await adminDb();
  const rows = await db
    .select()
    .from(guestActions)
    .where(and(eq(guestActions.guestId, guestId), eq(guestActions.kind, "feedback"), gte(guestActions.createdAt, new Date(now.getTime() - GUEST_TTL_MS))))
    .orderBy(desc(guestActions.createdAt));
  const out = new Map<string, { answer: Answer; subReason?: SubReason; state: string | null }>();
  for (const r of rows) {
    if (!r.flagId || out.has(r.flagId)) continue;
    const p = r.payload as { answer: Answer; subReason?: SubReason };
    out.set(r.flagId, { answer: p.answer, subReason: p.subReason, state: p.answer === "numbers_wrong" && p.subReason === "one_off" ? "marked_fine" : STATE_AFTER[p.answer] });
  }
  return out;
}

export async function guestShortlist(guestId: string, now = new Date()) {
  const db = await adminDb();
  const rows = await db
    .select()
    .from(guestActions)
    .where(and(eq(guestActions.guestId, guestId), eq(guestActions.kind, "shortlist"), gte(guestActions.createdAt, new Date(now.getTime() - GUEST_TTL_MS))))
    .orderBy(guestActions.createdAt);
  return rows.map((r) => ({ appId: r.appId!, lineKey: r.lineKey ?? "", addedAt: r.createdAt }));
}

export async function guestShortlistAdd(guestId: string, orgId: string, appId: string, lineKey?: string | null) {
  const have = await guestShortlist(guestId);
  if (!have.some((x) => x.appId === appId && x.lineKey === (lineKey ?? ""))) {
    await (await adminDb()).insert(guestActions).values({ guestId, orgId, kind: "shortlist", appId, lineKey: lineKey ?? "" });
  }
  return guestShortlist(guestId);
}

export async function guestShortlistRemove(guestId: string, appId: string) {
  await (await adminDb()).delete(guestActions).where(and(eq(guestActions.guestId, guestId), eq(guestActions.kind, "shortlist"), eq(guestActions.appId, appId)));
  return guestShortlist(guestId);
}

/** Nightly: forget everything guests did more than 24 hours ago. */
export async function purgeGuests(now = new Date()): Promise<number> {
  const gone = await (await adminDb()).delete(guestActions).where(lt(guestActions.createdAt, new Date(now.getTime() - GUEST_TTL_MS))).returning({ id: guestActions.id });
  return gone.length;
}
