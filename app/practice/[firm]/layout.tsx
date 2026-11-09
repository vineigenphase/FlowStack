import { env } from "@/lib/env";
import type { ReactNode } from "react";
import Link from "next/link";
import { HttpError } from "@/lib/api";
import { requireFirmMember } from "@/lib/firms";
import { FirmNav } from "@/components/firm-nav";
import { SignOut } from "@/components/sign-out";
import { signInHref } from "@/lib/ui/signin";

export const dynamic = "force-dynamic";

/** Header, sign-in gate and tabs for practice pages. Each page still checks membership itself. */
export default async function FirmLayout({ children, params }: { children: ReactNode; params: Promise<{ firm: string }> }) {
  const { firm } = await params;
  let name: string;
  try {
    name = (await requireFirmMember(firm)).firmName;
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      const si = signInHref(`/practice/${firm}`);
      return (
        <main className="wrap">
          <h1>Sign in</h1>
          <p><a className="btn" href={si.href}>{si.dev ? "Sign in (local sample data)" : "Sign in with Xero"}</a></p>
        </main>
      );
    }
    return (
      <main className="wrap">
        <h1>Not found</h1>
        <p>This practice doesn&apos;t exist or you&apos;re not in it. <Link href="/practice">Your practices</Link></p>
      </main>
    );
  }
  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          <Link href="/" className="brand">FlowStack</Link>
          <span className="org-name">{name}</span>
          <Link href="/apps" className="top-link">Apps</Link>
          <SignOut />
        </div>
        <div className="wrap"><FirmNav firm={firm} digest={env().MONDAY_DIGEST_ENABLED} /></div>
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
