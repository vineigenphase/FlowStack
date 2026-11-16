import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { demoEnabled, ensureDemoOrg, newGuest } from "@/lib/demo";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * /demo (NEXT-STEPS P0.2): a 24-hour read-only guest session on the sample business, then its overview.
 * Off unless DEMO_ENABLED. No sign-in, no Xero, nothing a guest does reaches real data or metrics.
 */
export async function GET() {
  if (!demoEnabled()) return new NextResponse("Not found", { status: 404 });
  try {
    const orgId = await ensureDemoOrg();
    const s = await getSession();
    Object.assign(s, newGuest(orgId));
    s.activeOrgId = s.userId ? s.activeOrgId : orgId;
    await s.save();
    return NextResponse.redirect(new URL(`/app/${orgId}`, env().APP_URL));
  } catch (e) {
    log.error({ err: { message: (e as Error).message } }, "demo failed");
    return new NextResponse("The demo couldn't start. Try again in a minute.", { status: 503 });
  }
}
