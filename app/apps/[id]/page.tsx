import Link from "next/link";
import { notFound } from "next/navigation";
import { appCategories } from "@/lib/catalog/load";
import { getApp } from "@/lib/catalog/directory";
import { SiteHeader } from "@/components/site-header";
import { FACT_GROUPS, factText } from "@/lib/ui/facts";

export const dynamic = "force-dynamic";

const LINK: Record<string, string> = { native: "Direct", via_app: "Through another app", csv: "CSV import (by hand)" };
const day = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "medium" });

/** One app's dossier (CLAUDE.md §7.3b): every fact with its source and date, or an honest "not published". */
export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getApp(id);
  if (!a) notFound();
  const cats = new Map(appCategories().map((c) => [c.key, c.label]));
  const byField = new Map(a.facts.map((f) => [f.field, f]));
  const xero = a.integrations.find((i) => i.to === "xero");
  const others = a.integrations.filter((i) => i.to !== "xero");

  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <p className="meta"><Link href="/apps">← All apps</Link></p>
        <h1>
          {a.name}
          {a.sample ? <span className="tag">draft entry</span> : null}
        </h1>
        <p className="meta">
          {a.categories.map((c) => cats.get(c) ?? c).join(" · ")} · {a.markets.join(", ")}
          {a.website ? <> · <a href={a.website} rel="noopener noreferrer" target="_blank">{new URL(a.website).hostname.replace(/^www\./, "")}</a></> : null}
        </p>

        {FACT_GROUPS.map((g) => (
          <section key={g.label} className="dossier">
            <h2>{g.label}</h2>
            <dl>
              {g.fields.map((field) => {
                const f = byField.get(field as never);
                if (!f) return null;
                const known = f.state !== "missing";
                return (
                  <div key={field} className={known ? "fact" : "fact missing"}>
                    <dt>{f.label}</dt>
                    <dd>
                      {known ? <b>{factText(field, f.value)}</b> : <span className="muted">Not published · we&apos;re checking</span>}
                      {known && "quote" in f && f.quote ? <q className="quote">{String(f.quote).replace(/\s+/g, " ")}</q> : null}
                      {known ? (
                        <span className="muted small block">
                          {f.display}
                          {f.source_url ? <> · <a href={f.source_url} rel="noopener noreferrer" target="_blank">source</a></> : null}
                          {f.checked_at ? <> · {day(f.checked_at)}</> : null}
                          {f.state === "conflicting" ? " · sources disagree" : null}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                );
              })}
              {g.label === "Fit with Xero" ? (
                <>
                  <div className="fact">
                    <dt>Connects to Xero</dt>
                    <dd>{xero ? <b>{LINK[xero.kind]}</b> : <span className="muted">Not confirmed by us yet</span>}<span className="muted small block">Vendor site mentions Xero; not yet checked by a person</span></dd>
                  </div>
                  {others.length ? (
                    <div className="fact">
                      <dt>Works with</dt>
                      <dd>
                        {others.map((o, i) => (
                          <span key={o.to}>
                            {i ? ", " : ""}
                            <Link href={`/apps/${o.to}`}>{o.name}</Link> <span className="muted small">({LINK[o.kind]?.toLowerCase()})</span>
                          </span>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                </>
              ) : null}
              {g.label === "Price" ? (
                <div className="fact missing">
                  <dt>What similar businesses pay</dt>
                  <dd><span className="muted">Not enough peers yet. Shown once 10 or more connected businesses pay for it, as a range only.</span></dd>
                </div>
              ) : null}
            </dl>
          </section>
        ))}

        <p className="muted small">
          Facts are read from {a.name}&apos;s own website and stored only with the exact words they came from. &quot;From the vendor&apos;s
          site&quot; means a person hasn&apos;t checked it yet. Something wrong? Vendors can claim and correct their listing for free; it never
          changes ranking.
        </p>
      </main>
    </>
  );
}
