import { HttpError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { allBusinesses, generalLinks, orgLinks, SITES } from "@/lib/dev/links";
import { panelLines } from "@/lib/dev/lines";
import { SiteHeader } from "@/components/site-header";
import { DevMount } from "@/components/dev/dev-mount";
import { DevLinks } from "@/components/dev/dev-links";
import { AdminSignIn } from "@/components/admin-sign-in";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev links · FlowStack" };

/** Every admin, dev and business link as a full URL with Copy buttons. Admins only. ?org= expands one business's lines. */
export default async function LinksPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return (
      <>
        <SiteHeader />
        <main className="wrap">
          <h1>Dev links</h1>
          <AdminSignIn next="/admin/links" />
        </main>
      </>
    );
  }
  const { org } = await searchParams;
  const businesses = await allBusinesses();
  const focus = org && businesses.some((b) => b.id === org) ? org : null;
  const lines = focus ? await panelLines(focus) : [];
  return (
    <>
      <SiteHeader />
      <DevMount org={focus} />
      <main className="wrap" id="links">
        <h1>Dev links</h1>
        <p className="lede">Every admin and dev link, ready to copy. Dev tools and the dev APIs need DEV_TOOLS=true and an admin account.</p>
        <DevLinks groups={generalLinks()} sites={SITES} />
        <h2>Businesses ({businesses.length})</h2>
        <ul className="dev-link-list">
          {businesses.map((b) => (
            <li key={b.id}>
              <span className="dev-link-label">
                {b.name}
                {b.sample ? <span className="tag">sample</span> : null}
              </span>
              <span className="code small">{b.id}</span>
              <a className="small" href={`/admin/links?org=${b.id}#business`}>
                {focus === b.id ? "Showing below" : "All links for this business"}
              </a>
            </li>
          ))}
        </ul>
        {focus ? (
          <section id="business">
            <h2>{businesses.find((b) => b.id === focus)?.name}</h2>
            <DevLinks groups={orgLinks(focus, lines)} />
          </section>
        ) : null}
      </main>
    </>
  );
}
