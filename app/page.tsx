import Link from "next/link";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { adminDb } from "@/lib/db/client";
import { orgMembers, orgs } from "@/db/schema";
import { SignOut } from "@/components/sign-out";
import { signInHref } from "@/lib/ui/signin";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default async function Home() {
  const s = await getSession();
  const si = signInHref();
  const mine = s.userId
    ? await (await adminDb())
        .select({ id: orgs.id, name: orgs.name, sample: orgs.sample })
        .from(orgMembers)
        .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
        .where(eq(orgMembers.userId, s.userId))
    : [];

  return (
    <>
    <SiteHeader />
    <main className="wrap">
      <h1 className="display">FlowStack</h1>
      <p className="lede">Which apps your Xero ledger says you need, based on your own figures. Read-only: we never change anything in Xero.</p>
      {s.userId ? (
        <>
          <h2>Your organisations</h2>
          {mine.length ? (
            <ul className="cards">
              {mine.map((o) => (
                <li key={o.id} className="card">
                  <Link href={`/app/${o.id}`} className="card-link">
                    <span className="card-head">
                      <b>
                        {o.name}
                        {o.sample ? <span className="tag">sample data</span> : null}
                      </b>
                      <span aria-hidden>→</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No organisations connected yet.</p>
          )}
          <p className="actions">
            {si.dev ? null : <a className="btn" href={si.href}>Connect another Xero organisation</a>}
            <SignOut />
          </p>
        </>
      ) : (
        <p className="actions">
          <a className="btn" href={si.href}>{si.dev ? "Sign in (local sample data)" : "Connect Xero"}</a>
        </p>
      )}
    </main>
    </>
  );
}
