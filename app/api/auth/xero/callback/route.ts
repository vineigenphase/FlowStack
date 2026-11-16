import { NextResponse, after, type NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { getOAuthState, getSession } from "@/lib/auth/session";
import { completeConnect } from "@/lib/auth/connect";
import { executeRefresh, startRefresh, type RunRow } from "@/lib/sync/refresh";
import { errorText } from "@/lib/sync/error-text";

export const dynamic = "force-dynamic";

/** Exchange the code, verify the id_token, upsert user/org/connection, start the first refresh. */
export const GET = handle(async (req: NextRequest) => {
  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  if (err) throw new HttpError(400, `Xero declined: ${err}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const oauth = await getOAuthState();
  if (!code || !state || !oauth.state || state !== oauth.state || !oauth.verifier) {
    throw new HttpError(400, "Sign-in expired or state mismatch. Start again.");
  }
  const verifier = oauth.verifier;
  oauth.destroy();

  const { user, orgIds, created, capped } = await completeConnect(code, verifier);

  const s = await getSession();
  s.userId = user.id;
  s.email = user.email;
  s.isAdmin = user.isAdmin;
  if (orgIds[0]) s.activeOrgId = orgIds[0];
  await s.save();

  // First refresh (NEXT-STEPS P0.3): runs are created now, their steps run after the response, and the user
  // watches them on /connect/progress.
  const runs: { orgId: string; run: RunRow }[] = [];
  for (const orgId of created) {
    try {
      runs.push({ orgId, run: await startRefresh(orgId) });
    } catch (e) {
      log.error({ orgId, message: errorText(e) }, "first refresh couldn't start");
    }
  }
  after(async () => {
    for (const { orgId, run } of runs) {
      try {
        await executeRefresh(orgId, run);
      } catch (e) {
        log.error({ orgId, message: errorText(e) }, "first refresh failed");
      }
    }
  });

  // v1.1 I: businesses over the plan cap are not taken on; say so instead of failing.
  if (!orgIds.length) return NextResponse.redirect(new URL(`/connect/limit?capped=${capped.length}`, env().APP_URL));
  const tail = capped.length ? `&capped=${capped.length}` : "";
  if (runs[0]) return NextResponse.redirect(new URL(`/connect/progress?run=${runs[0].run.id}${tail}`, env().APP_URL));
  return NextResponse.redirect(new URL(`/app/${orgIds[0]}${capped.length ? `?capped=${capped.length}` : ""}`, env().APP_URL));
});
