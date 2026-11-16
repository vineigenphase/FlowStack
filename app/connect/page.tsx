import Link from "next/link";
import { accessMode } from "@/lib/access";
import { signInHref } from "@/lib/ui/signin";
import { demoEnabled } from "@/lib/demo";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  access_denied: "You cancelled the Xero connection. Nothing was shared.",
  invite_only:
    "FlowStack is invite-only while we test it. Join the waitlist, or enter the invite code you were given. Your Xero connection was removed again.",
};

/**
 * Before you connect (UI-SPEC §5.2), plain until the designer's version. With ACCESS_MODE=invite, an invite code
 * field goes to /api/auth/xero/start?invite=… (NEXT-STEPS P0.5).
 */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const si = signInHref();
  const invite = accessMode() === "invite";
  return (
    <main className="wrap">
      <h1>Connect your Xero</h1>
      {error ? (
        <p className="banner" role="alert">
          {ERRORS[error] ?? "The Xero connection didn't finish. Try again."}
        </p>
      ) : null}
      <section className="panel">
        <h2>What we read</h2>
        <p>Your reports, chart of accounts and supplier totals. Read-only.</p>
        <h2>What we never do</h2>
        <ul className="plain">
          <li>Write to your books.</li>
          <li>Store individual transactions.</li>
          <li>Train AI on your data.</li>
          <li>Sell your data.</li>
        </ul>
        <p className="muted small">You can disconnect at any time in Settings; we delete your data when you do.</p>
      </section>

      {invite && !si.dev ? (
        <form action="/api/auth/xero/start" method="get" className="panel">
          <label htmlFor="invite">Invite code</label>
          <input id="invite" name="invite" autoComplete="off" placeholder="FS-XXXX-XXXX" />
          <p className="muted small">Already approved from the waitlist? Leave it empty.</p>
          <button type="submit" className="btn">
            Connect Xero
          </button>
        </form>
      ) : (
        <p>
          <a className="btn" href={si.href}>
            {si.dev ? "Sign in (local sample data)" : "Connect Xero"}
          </a>
        </p>
      )}
      <p className="muted small">
        Look after several businesses? Connect one now; you can add the others straight after.
        {demoEnabled() ? (
          <>
            {" "}Just looking? <Link href="/demo">See a sample business</Link>.
          </>
        ) : null}
      </p>
    </main>
  );
}
