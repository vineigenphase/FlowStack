import { NextResponse, after, type NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { getOAuthState, getSession } from "@/lib/auth/session";
import { completeConnect } from "@/lib/auth/connect";
import { runRefresh } from "@/lib/sync/refresh";

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

  const { user, orgIds, created } = await completeConnect(code, verifier);

  const s = await getSession();
  s.userId = user.id;
  s.email = user.email;
  s.isAdmin = user.isAdmin;
  await s.save();

  // First refresh runs after the response (inline work; Inngest replaces this in M9).
  after(async () => {
    for (const orgId of created) {
      try {
        await runRefresh(orgId);
      } catch (e) {
        log.error({ orgId, message: (e as Error).message }, "first refresh failed");
      }
    }
  });

  return NextResponse.redirect(new URL(`/app/${orgIds[0]}`, env().APP_URL));
});
