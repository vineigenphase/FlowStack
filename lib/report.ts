/**
 * "Report a problem" (NEXT-STEPS P0.5): the page, the last reference shown on an error, and a short note go to the
 * review queue as `user_report`. Testers and demo guests can send one; nothing else is attached (no figures).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { enqueue } from "@/lib/queue/enqueue";

export const ReportInput = z.object({
  url: z.string().trim().max(500),
  requestId: z.string().trim().max(80).optional(),
  note: z.string().trim().min(3, "Tell us a little about what happened").max(1000),
});

/** The org a page belongs to, from its path (/app/<org>/…), if it's one the reporter may read. */
export function orgFromUrl(url: string): string | null {
  const m = url.match(/\/app\/([0-9a-f-]{36})(?:[/?#]|$)/i);
  return m ? m[1]!.toLowerCase() : null;
}

export async function submitReport(input: z.infer<typeof ReportInput>, who: { email?: string | null; guestId?: string | null }, orgId: string | null) {
  let path = input.url;
  try {
    const u = new URL(input.url);
    path = u.pathname + u.search; // our own host only matters for the path; drop it
  } catch {
    // not a full URL: keep what was sent
  }
  const reporter = who.email || (who.guestId ? `demo guest ${who.guestId.slice(0, 8)}` : "unknown");
  await enqueue({
    kind: "user_report",
    orgId,
    ref: { report_id: randomUUID() },
    reason: `Problem report from ${reporter} on ${path}${input.requestId ? ` (reference ${input.requestId})` : ""}: ${input.note}`,
  });
  return { ok: true as const, message: "Thanks. We've got it and will look at it." };
}
