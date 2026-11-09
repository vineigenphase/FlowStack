import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { connectionUse } from "@/lib/me";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connection limit · FlowStack" };

/**
 * v1.1 I: Xero's plan caps how many businesses our app can connect in total (Starter 5, Core 50).
 * Reconnecting a business we already have always works, so the user can carry on to sign in.
 */
export default async function LimitPage({ searchParams }: { searchParams: Promise<{ capped?: string }> }) {
  const { capped } = await searchParams;
  const u = await connectionUse();
  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <h1>We&apos;re at our connection limit</h1>
        <p>
          FlowStack is in early access on Xero&apos;s starter plan, which lets us connect {u.cap} businesses in total. {u.used} of {u.cap} are in use.
          {capped && Number(capped) > 0 ? ` So we didn't add the ${Number(capped) === 1 ? "business" : `${capped} businesses`} you just chose.` : ""}
        </p>
        <p>
          Already connected? <a href="/api/auth/xero/start?confirm=1">Sign in or reconnect</a>: that always works. Accountants with more clients: tell us and
          we&apos;ll move to a bigger Xero plan (50 connections).
        </p>
        <p><Link href="/">Home</Link></p>
      </main>
    </>
  );
}
