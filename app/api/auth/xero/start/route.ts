import { NextResponse, type NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { env } from "@/lib/env";
import { getOAuthState } from "@/lib/auth/session";
import { authorizeUrl, newPkce } from "@/lib/xero/oauth";
import { connectionUse } from "@/lib/me";
import { safeNext } from "@/lib/ui/signin";

export const dynamic = "force-dynamic";

/** PKCE + state cookie → redirect to Xero's consent screen. */
export const GET = handle(async (req: NextRequest) => {
  if (!env().XERO_CLIENT_ID || !env().XERO_CLIENT_SECRET) {
    throw new HttpError(503, "Xero app not configured: set XERO_CLIENT_ID and XERO_CLIENT_SECRET (or use /api/dev/login in fixtures mode)");
  }
  // v1.1 I: at the plan's connection cap, explain first. "confirm=1" carries on (sign in / reconnect always works).
  if (new URL(req.url).searchParams.get("confirm") !== "1" && (await connectionUse()).full) {
    return NextResponse.redirect(new URL("/connect/limit", env().APP_URL));
  }
  const p = newPkce();
  const s = await getOAuthState();
  s.verifier = p.verifier;
  s.state = p.state;
  // NEXT-STEPS P0.5: an invite code typed on /connect rides along to the callback (checked there, after sign-in).
  const invite = new URL(req.url).searchParams.get("invite")?.trim();
  s.invite = invite ? invite.slice(0, 40) : undefined;
  // Where to land after sign-in (e.g. an /admin page). Same-site paths only.
  s.next = safeNext(new URL(req.url).searchParams.get("next"));
  await s.save();
  return NextResponse.redirect(authorizeUrl(p));
});
