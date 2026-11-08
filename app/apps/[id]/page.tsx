import Link from "next/link";
import { notFound } from "next/navigation";
import { appCategories } from "@/lib/catalog/load";
import { getApp } from "@/lib/catalog/directory";
import { SiteHeader } from "@/components/site-header";
import { FACT_GROUPS, factText } from "@/lib/ui/facts";
import { peerBand } from "@/lib/prices";
import { PRICE_BANDS, publicReviews, ROLES, SCORE_LABELS } from "@/lib/reviews";
import { MIN_FOR_RESPONSE_TIME, responseTime } from "@/lib/quotes";

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
  const [peer, rv, rt] = await Promise.all([peerBand(a.id), publicReviews(a.id), responseTime(a.id)]);

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
                <div className={rt.days === null ? "fact missing" : "fact"}>
                  <dt>Replies to quote requests</dt>
                  <dd>
                    {rt.days === null ? (
                      <span className="muted">Not enough requests yet ({rt.n} of {MIN_FOR_RESPONSE_TIME} needed)</span>
                    ) : (
                      <>
                        <b>In about {rt.days} days</b>
                        <span className="muted small block">Middle value across {rt.n} quote requests sent through FlowStack.</span>
                      </>
                    )}
                  </dd>
                </div>
              ) : null}
              {g.label === "Price" ? (
                <div className="fact missing">
                  <dt>What similar businesses pay</dt>
                  <dd>
                    {peer ? (
                      <>
                        <b className="num">£{Math.round(peer.p25).toLocaleString("en-GB")}–£{Math.round(peer.p75).toLocaleString("en-GB")} a month</b>
                        <span className="muted small block">
                          Middle half of {peer.n} businesses that pay for it (median £{Math.round(peer.median).toLocaleString("en-GB")}), from their own bills
                          over the last 12 months. Only businesses that agreed to share are counted.
                        </span>
                      </>
                    ) : (
                      <span className="muted">Not enough peers yet. Shown once 10 or more connected businesses pay for it, as a range only.</span>
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        ))}

        <section className="dossier reviews">
          <h2>Reviews from businesses that pay for it</h2>
          {rv.reviews.length ? (
            <>
              <dl className="totals">
                {(Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).map((k) => (
                  <div key={k}>
                    <dt>{SCORE_LABELS[k]}</dt>
                    <dd className="num">{rv.averages![k]}/5</dd>
                  </div>
                ))}
              </dl>
              <ol className="plain review-list">
                {rv.reviews.map((r) => (
                  <li key={r.id} className="card">
                    <span className="card-head">
                      <b>{ROLES.find((x) => x.key === r.role)?.label ?? "Reviewer"}</b>
                      <span className="badge b-covered">Verified: paid for it {r.verifiedMonths} months</span>
                    </span>
                    {r.incentivised ? <span className="tag">incentivised: the reviewer got something for writing it</span> : null}
                    <span className="small muted">
                      {(Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).map((k) => `${SCORE_LABELS[k]} ${r.scores[k]}/5`).join(" · ")}
                      {r.priceBand ? ` · pays ${PRICE_BANDS.find((p) => p.key === r.priceBand)?.label.toLowerCase()}` : ""}
                    </span>
                    <span>{r.body}</span>
                    {r.followupSupport !== null ? <span className="small">90 days on, support after go-live: {r.followupSupport}/5</span> : null}
                    <span className="muted small">{day(r.publishedAt)}</span>
                    {r.reply ? (
                      <span className="vendor-reply small">
                        <b>Reply from {r.reply.vendorName}:</b> {r.reply.body}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">
              No reviews yet. Only businesses whose own Xero shows they&apos;ve paid for {a.name} for 2 months or more can review it, and we never
              write reviews ourselves.
            </p>
          )}
          <p className="muted small">Newest first. Vendors can reply but can&apos;t edit, hide or reorder reviews.</p>
        </section>

        <p className="muted small">
          Facts are read from {a.name}&apos;s own website and stored only with the exact words they came from. &quot;From the vendor&apos;s
          site&quot; means a person hasn&apos;t checked it yet. Something wrong? Vendors can claim and correct their listing for free; it never
          changes ranking.
        </p>
      </main>
    </>
  );
}
