import { env } from "@/lib/env";

/**
 * Where "Sign in / Connect Xero" points. On a local copy with sample data and no Xero app keys,
 * the Xero route can only fail, so use the dev sign-in (which is itself refused in production).
 */
/** Only same-site paths survive as a return address (no //host or scheme). */
export function safeNext(next: string | null | undefined): string | undefined {
  return next && /^\/(?![/\\])/.test(next) && next.length <= 200 ? next : undefined;
}

export function signInHref(next = "/"): { href: string; dev: boolean } {
  const e = env();
  const dev = e.NODE_ENV !== "production" && e.XERO_MODE === "fixtures" && !(e.XERO_CLIENT_ID && e.XERO_CLIENT_SECRET);
  return dev ? { href: `/api/dev/login?next=${encodeURIComponent(next)}`, dev } : { href: next === "/" ? "/api/auth/xero/start" : `/api/auth/xero/start?confirm=1&next=${encodeURIComponent(next)}`, dev };
}
