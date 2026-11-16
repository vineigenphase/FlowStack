import { body, handle, HttpError } from "@/lib/api";
import { getSession, guestOn } from "@/lib/auth/session";
import { isMember } from "@/lib/me";
import { orgFromUrl, ReportInput, submitReport } from "@/lib/report";

export const dynamic = "force-dynamic";

/** "Report a problem" → a user_report queue item (NEXT-STEPS P0.5). Signed-in users and demo guests only. */
export const POST = handle(async (req: Request) => {
  const s = await getSession();
  const b = await body(req, ReportInput);
  const pageOrg = orgFromUrl(b.url);
  // The report is filed against the page's business only when the reporter can read it.
  let orgId: string | null = null;
  let guestId: string | null = null;
  if (pageOrg) {
    guestId = await guestOn(pageOrg);
    if (guestId || (s.userId && (await isMember(s.userId, pageOrg)))) orgId = pageOrg;
  }
  if (!s.userId && !guestId) throw new HttpError(401, "Sign in, or open the demo, to send a report");
  return submitReport(b, { email: s.email ?? null, guestId }, orgId);
});
