import type { ReactNode } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { HttpError } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { withOrg } from "@/lib/db/client";
import { orgs } from "@/db/schema";
import { OrgNav } from "@/components/org-nav";
import { SignOut } from "@/components/sign-out";

export const dynamic = "force-dynamic";

/** Header, sign-in gate and tabs for every org page. Each page still checks membership itself. */
export default async function OrgLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireOrgMember(org);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      return (
        <main className="wrap">
          <h1>Sign in</h1>
          <p>Sign in to see this organisation.</p>
          <p><a className="btn" href="/api/auth/xero/start">Sign in with Xero</a></p>
        </main>
      );
    }
    return (
      <main className="wrap">
        <h1>Not found</h1>
        <p>This organisation doesn&apos;t exist or you&apos;re not a member. <Link href="/">Home</Link></p>
      </main>
    );
  }
  const [o] = await withOrg(org, (tx) => tx.select({ name: orgs.name, sample: orgs.sample }).from(orgs).where(eq(orgs.id, org)));
  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          <Link href="/" className="brand">FlowStack</Link>
          <span className="org-name">
            {o?.name ?? "Organisation"}
            {o?.sample ? <span className="tag">sample data</span> : null}
          </span>
          <SignOut />
        </div>
        <div className="wrap"><OrgNav org={org} /></div>
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
