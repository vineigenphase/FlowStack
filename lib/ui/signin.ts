import { env } from "@/lib/env";

/**
 * Where "Sign in / Connect Xero" points. On a local copy with sample data and no Xero app keys,
 * the Xero route can only fail, so use the dev sign-in (which is itself refused in production).
 */
export function signInHref(next = "/"): { href: string; dev: boolean } {
  const e = env();
  const dev = e.NODE_ENV !== "production" && e.XERO_MODE === "fixtures" && !(e.XERO_CLIENT_ID && e.XERO_CLIENT_SECRET);
  return dev ? { href: `/api/dev/login?next=${encodeURIComponent(next)}`, dev } : { href: "/api/auth/xero/start", dev };
}
