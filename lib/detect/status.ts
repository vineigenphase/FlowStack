/**
 * The user's answers about their apps (BACKEND.md §6.1, v1.1 C), asked in the app only:
 *   "We haven't seen a payment to Pleo since August. Do you still use it?"  still_use | moved (to …) | stopped
 *   "Is Ramp replacing Pleo?"                                               replacing | both
 * Answers are stored per org (RLS), then detection and flags are recomputed from stored rows (no Xero calls).
 */
import { desc } from "drizzle-orm";
import { appStatusAnswers, detectedApps } from "@/db/schema";
import { withOrg } from "@/lib/db/client";
import { HttpError } from "@/lib/api";
import { apps as catalogApps } from "@/lib/catalog/load";
import { enqueue } from "@/lib/queue/enqueue";
import { redetect } from "@/lib/queue/resolve";
import { recompute } from "@/lib/sync/refresh";

export type StatusInput =
  | { answer: "still_use" | "stopped" }
  | { answer: "moved"; replacedBy: string }
  | { answer: "replacing"; old: string }
  | { answer: "both" };

const name = (id: string) => catalogApps().find((a) => a.id === id)?.name ?? id;
const known = (id: string) => catalogApps().some((a) => a.id === id);

export async function answerAppStatus(orgId: string, appId: string, userId: string | null, input: StatusInput) {
  if (!known(appId)) throw new HttpError(404, "Unknown app");
  await withOrg(orgId, async (tx) => {
    const row = { orgId, userId };
    if (input.answer === "moved") {
      if (!known(input.replacedBy) || input.replacedBy === appId) throw new HttpError(422, "Pick the app you moved to");
      await tx.insert(appStatusAnswers).values({ ...row, appId, answer: "moved", replacedByAppId: input.replacedBy });
      await tx.insert(appStatusAnswers).values({ ...row, appId: input.replacedBy, answer: "declared" });
    } else if (input.answer === "replacing") {
      // Asked on the new app: "Is <appId> replacing <old>?" → yes.
      if (!known(input.old)) throw new HttpError(422, "Unknown app");
      await tx.insert(appStatusAnswers).values({ ...row, appId: input.old, answer: "replacing", replacedByAppId: appId });
      await tx.insert(appStatusAnswers).values({ ...row, appId, answer: "both" }); // don't ask again about the new app
    } else {
      await tx.insert(appStatusAnswers).values({ ...row, appId, answer: input.answer });
    }
  });
  if (input.answer === "moved") {
    await enqueue({
      kind: "fingerprint_check",
      orgId,
      ref: { org_id: orgId, declared_app: input.replacedBy, from_app: appId },
      reason: `The business says it moved from ${name(appId)} to ${name(input.replacedBy)}, but no payments to ${name(input.replacedBy)} show yet. Check its supplier names.`,
    });
  }
  await redetect(orgId);
  await recompute(orgId);
  return { ok: true };
}

/** Questions to show on the summary page, from the latest detection. */
export async function appQuestions(orgId: string) {
  const rows = await withOrg(orgId, (tx) => tx.select().from(detectedApps).orderBy(desc(detectedApps.lastSeen)));
  return rows
    .map((r) => {
      const ask = (r.evidence as { ask?: string | { replacing: string } }).ask;
      if (ask === "still_use") return { kind: "still_use" as const, appId: r.appId, name: name(r.appId), lastSeen: r.lastSeen };
      if (ask && typeof ask === "object") return { kind: "replacing" as const, appId: r.appId, name: name(r.appId), old: ask.replacing, oldName: name(ask.replacing) };
      return null;
    })
    .filter((q): q is NonNullable<typeof q> => q !== null);
}
