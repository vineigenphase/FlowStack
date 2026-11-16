/**
 * Tester access (NEXT-STEPS P0.5). With ACCESS_MODE=invite, connecting real Xero needs one of:
 *  - an account we already have (someone let in before keeps working),
 *  - an admin email (ADMIN_EMAILS),
 *  - a waitlist email an admin approved,
 *  - an invite code (limited uses, optional expiry).
 * People let in by approval or code are testers: their new businesses get `design_partner` (free, full access,
 * no Stripe). ACCESS_MODE=open (the default) lets anyone connect, as before. The plan's connection cap still applies.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { accessCodes, auditLog, users, waitlist } from "@/db/schema";
import { adminDb, type Db } from "@/lib/db/client";
import { adminEmails, env } from "@/lib/env";
import { HttpError } from "@/lib/api";

export const accessMode = (): "open" | "invite" => env().ACCESS_MODE;

export class AccessDeniedError extends Error {
  constructor() {
    super("FlowStack is invite-only for now. Join the waitlist, or use your invite code.");
  }
}

export type Access = { via: "open" | "existing" | "admin" | "approved" | "invite"; tester: boolean };

/** Normalise a typed code: case and spaces don't matter. */
export const normCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, "");

/**
 * Decide inside the connect transaction (so a refused person leaves no rows). Consumes one use of the code only
 * when the code is what lets them in.
 */
export async function checkAccess(tx: Db, email: string, invite?: string | null, now = new Date()): Promise<Access> {
  if (accessMode() === "open") return { via: "open", tester: false };
  const e = email.toLowerCase();
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, e));
  if (u) return { via: "existing", tester: false };
  if (adminEmails().includes(e)) return { via: "admin", tester: false };
  const [w] = await tx.select({ approvedAt: waitlist.approvedAt }).from(waitlist).where(eq(waitlist.email, e));
  if (w?.approvedAt) return { via: "approved", tester: true };
  if (invite) {
    const [used] = await tx
      .update(accessCodes)
      .set({ uses: sql`${accessCodes.uses} + 1` })
      .where(and(eq(accessCodes.code, normCode(invite)), lt(accessCodes.uses, accessCodes.maxUses), or(isNull(accessCodes.expiresAt), gt(accessCodes.expiresAt, now))))
      .returning({ code: accessCodes.code });
    if (used) return { via: "invite", tester: true };
  }
  throw new AccessDeniedError();
}

// ---------- admin ----------

export async function approveEmail(email: string, by: string, now = new Date()) {
  const db = await adminDb();
  const e = email.trim().toLowerCase();
  const [row] = await db.update(waitlist).set({ approvedAt: now, approvedBy: by }).where(eq(waitlist.email, e)).returning({ email: waitlist.email });
  if (!row) throw new HttpError(404, "That email isn't on the waitlist");
  await db.insert(auditLog).values({ actor: by, action: "tester.approved", target: { email: e } });
  return { approved: e };
}

/** A readable code like FS-7K2M-Q9XD (no 0/O/1/I). Shown once to the admin; stored as typed. */
export function newCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(8);
  const part = (o: number) => Array.from({ length: 4 }, (_, i) => alphabet[b[o + i]! % alphabet.length]).join("");
  return `FS-${part(0)}-${part(4)}`;
}

export async function createCode(opts: { by: string; note?: string; maxUses?: number; expiresDays?: number }, now = new Date()) {
  const db = await adminDb();
  const code = newCode();
  const expiresAt = opts.expiresDays ? new Date(now.getTime() + opts.expiresDays * 86_400_000) : null;
  await db.insert(accessCodes).values({ code, note: opts.note ?? null, maxUses: opts.maxUses ?? 1, expiresAt, createdBy: opts.by });
  await db.insert(auditLog).values({ actor: opts.by, action: "tester.code_created", target: { code, maxUses: opts.maxUses ?? 1 } });
  return { code, maxUses: opts.maxUses ?? 1, expiresAt };
}

export async function testersView() {
  const db = await adminDb();
  const people = await db.select().from(waitlist).orderBy(desc(waitlist.createdAt));
  const codes = await db.select().from(accessCodes).orderBy(desc(accessCodes.createdAt));
  return { mode: accessMode(), people, codes };
}
