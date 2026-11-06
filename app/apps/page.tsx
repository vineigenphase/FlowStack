import Link from "next/link";
import { appCategories } from "@/lib/catalog/load";
import { listApps } from "@/lib/catalog/directory";
import { SiteHeader } from "@/components/site-header";
import { factText } from "@/lib/ui/facts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apps · FlowStack" };

const MARKETS = ["UK", "US", "CA", "AU"] as const;

/** Public directory. Alphabetical inside each finance job: nothing here is ranked, and no app pays to appear. */
export default async function AppsPage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const { market: m } = await searchParams;
  const market = MARKETS.find((x) => x === m) ?? undefined;
  const apps = (await listApps({ market })).sort((a, b) => a.name.localeCompare(b.name));
  const groups = appCategories()
    .map((c) => ({ ...c, apps: apps.filter((a) => a.categories.some((x) => x.key === c.key)) }))
    .filter((g) => g.apps.length);

  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <h1>Apps that work with Xero</h1>
        <p className="meta">
          {apps.length} apps across {groups.length} finance jobs. Alphabetical, never ranked: rankings only appear against your own figures,
          and no app pays to appear.
        </p>
        <nav className="chips" aria-label="Market">
          <Link href="/apps" aria-current={!market ? "page" : undefined}>All markets</Link>
          {MARKETS.map((x) => (
            <Link key={x} href={`/apps?market=${x}`} aria-current={market === x ? "page" : undefined}>{x}</Link>
          ))}
        </nav>
        <p className="note small">
          Draft catalogue: every entry is unchecked by a person yet. Facts and prices come only from each vendor&apos;s own site, with the
          exact words and page they came from. Anything we couldn&apos;t find says so.
        </p>

        {groups.map((g) => (
          <section key={g.key}>
            <h2>{g.label} <span className="muted small">{g.apps.length}</span></h2>
            <ul className="dir">
              {g.apps.map((a) => (
                <li key={a.id}>
                  <Link href={`/apps/${a.id}`} className="dir-link">
                    <b>{a.name}</b>
                    <span className="small">
                      {a.priceFrom.state === "found" || a.priceFrom.state === "verified" ? factText("price_from_gbp", a.priceFrom.value) : <span className="muted">Price not published</span>}
                    </span>
                    <span className="muted small">{a.markets.join(" · ")} · {a.factsKnown}/{a.factsTotal} facts</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
