import Link from "next/link";
import { HttpError } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { myFirms } from "@/lib/firms";
import { SiteHeader } from "@/components/site-header";
import { CreateFirmForm } from "@/components/practice-forms";
import { signInHref } from "@/lib/ui/signin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Practices · FlowStack" };

/** For accounting firms and fractional CFOs: one place for every client's stack. */
export default async function PracticesPage() {
  let userId: string;
  try {
    userId = (await requireUser()).userId;
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    const si = signInHref("/practice");
    return (
      <>
        <SiteHeader />
        <main className="wrap">
          <h1>For accounting firms</h1>
          <p>See every client&apos;s stack in one place, ranked by what&apos;s at stake.</p>
          <p><a className="btn" href={si.href}>{si.dev ? "Sign in (local sample data)" : "Sign in with Xero"}</a></p>
        </main>
      </>
    );
  }
  const firms = await myFirms(userId);
  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <h1>Your practices</h1>
        {firms.length ? (
          <ul className="cards">
            {firms.map((f) => (
              <li key={f.id}>
                <Link href={`/practice/${f.id}`} className="card-link card">
                  <b>{f.name}</b>
                  <span className="muted small">{f.role === "owner" ? "You run this practice" : "Member"}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta">Start a practice to see every client&apos;s stack in one place. Colleagues join with a link.</p>
        )}
        <h2>Start a practice</h2>
        <CreateFirmForm />
      </main>
    </>
  );
}
