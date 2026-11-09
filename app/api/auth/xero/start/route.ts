import { NextResponse, type NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { env } from "@/lib/env";
import { getOAuthState } from "@/lib/auth/session";
import { authorizeUrl, newPkce } from "@/lib/xero/oauth";
import { connectionUse } from "@/lib/me";

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
  await s.save();
  return NextResponse.redirect(authorizeUrl(p));
});
