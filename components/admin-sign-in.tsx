import { getSession } from "@/lib/auth/session";
import { signInHref } from "@/lib/ui/signin";

/**
 * Shown on /admin pages to anyone who isn't an admin: a "Sign in with Xero" button that comes back to this page,
 * or, when signed in with a non-admin email, which account it is and a way to switch.
 */
export async function AdminSignIn({ next }: { next: string }) {
  const s = await getSession();
  const si = signInHref(next);
  const label = si.dev ? "Sign in (local sample data)" : "Sign in with Xero";
  if (!s.userId) {
    return (
      <>
        <p>This page is for the FlowStack team. Sign in with the Xero login that uses your admin email.</p>
        <p>
          <a className="btn" href={si.href}>{label}</a>
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        You&apos;re signed in as <strong>{s.email || "an unknown email"}</strong>, which isn&apos;t an admin account.
      </p>
      <p>
        <a className="btn ghost" href={si.href}>Sign in with a different Xero login</a>
      </p>
    </>
  );
}
