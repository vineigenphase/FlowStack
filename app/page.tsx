import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getMe, JOB_TITLES, myOrgs } from "@/lib/me";
import { SignOut } from "@/components/sign-out";
import { signInHref } from "@/lib/ui/signin";
import { SiteHeader } from "@/components/site-header";
import { JobTitleForm } from "@/components/job-title-form";
import { gbp } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

const when = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "medium" }) : null);

/** Home: sign in, or the user's businesses (v1.1 I: accountants and groups have several). */
export default async function Home() {
  const s = await getSession();
  const si = signInHref();
  const [me, mine] = s.userId ? await Promise.all([getMe(s.userId), myOrgs(s.userId)]) : [null, []];
  // Last used first, then by name.
  const ordered = [...mine].sort((a, b) => Number(b.id === s.activeOrgId) - Number(a.id === s.activeOrgId));

  return (
    <>
    <SiteHeader />
    <main className="wrap">
      <h1 className="display">FlowStack</h1>
      <p className="lede">Which apps your Xero ledger says you need, based on your own figures. Read-only: we never change anything in Xero.</p>
      {s.userId ? (
        <>
          {me && !me.jobTitle ? <JobTitleForm options={[...JOB_TITLES]} /> : null}
          <h2>Your businesses</h2>
          {ordered.length ? (
            <ul className="cards">
              {ordered.map((o) => (
                <li key={o.id} className="card">
                  <Link href={`/app/${o.id}`} className="card-link">
                    <span className="card-head">
                      <b>
                        {o.name}
                        {o.sample ? <span className="tag">sample data</span> : null}
                      </b>
                      <span aria-hidden>→</span>
                    </span>
                    <span className="muted small">
                      {o.atStake !== null ? <><span className="num">{gbp(o.atStake)}</span> at stake · </> : null}
                      {o.lastRefresh?.finishedAt ? `refreshed ${when(o.lastRefresh.finishedAt)}` : o.lastRefresh ? `refresh ${o.lastRefresh.status}` : "not refreshed yet"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No businesses connected yet.</p>
          )}
          <p className="actions">
            {si.dev ? null : <a className="btn" href={si.href}>Connect another business</a>}
            <SignOut />
          </p>
          {si.dev ? null : (
            <p className="muted small">Each Xero business is connected on its own (Xero asks you to pick one each time). Accountants: connect each client the same way.</p>
          )}
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
