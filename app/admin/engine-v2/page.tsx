import { HttpError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { engineV2Review, leafKeys, tierText } from "@/lib/appdb/review";
import { SiteHeader } from "@/components/site-header";
import { DevMount } from "@/components/dev/dev-mount";
import { AdminSignIn } from "@/components/admin-sign-in";

export const dynamic = "force-dynamic";
export const metadata = { title: "Engine v2 review · FlowStack" };

const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

/**
 * ENGINE-V2 review page for the team (admins only, not linked from the header): the 6 unsure listing matches, the
 * v2 weights with each part's share of the final match, the Xero → FlowStack category map and the app database
 * summary. Read-only. Plain admin styles until the Phase 3 restyle.
 */
export default async function EngineV2ReviewPage() {
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return (
      <>
        <SiteHeader />
      <DevMount />
        <main className="wrap">
          <h1>Engine v2</h1>
          <AdminSignIn next="/admin/engine-v2" />
        </main>
      </>
    );
  }
  const r = engineV2Review();
  const s = r.scoring;
  const leaves = r.weights.filter((w) => leafKeys.includes(w.key));

  return (
    <>
      <SiteHeader />
      <DevMount />
      <main className="wrap">
        <h1>Engine v2: review</h1>
        <p className="lede">
          The app database behind engine v2, the matches that need a person, and the weights it will rank with. Engine v2 changes the order of
          recommended apps only, never whether a line is flagged. Customers still see engine v1.
        </p>

        <div className="stats">
          <div className="stat">
            <div className="stat-num">{r.count.listings}</div>
            <div className="stat-label">Xero apps in the database</div>
            <div className="stat-sub">all are candidates (decided 23 Nov)</div>
          </div>
          <div className="stat">
            <div className="stat-num">{r.count.matched}</div>
            <div className="stat-label">matched to our catalogue</div>
          </div>
          <div className="stat">
            <div className="stat-num">{r.count.unsure}</div>
            <div className="stat-label">matches to check</div>
            <div className="stat-sub">below</div>
          </div>
          <div className="stat">
            <div className="stat-num">{r.prices.withGbp}</div>
            <div className="stat-label">apps with a £ price</div>
            <div className="stat-sub">{r.prices.converted} tiers converted to £</div>
          </div>
        </div>
        <p className="meta">
          Listing data captured {r.asOf} from the public Xero App Store (ratings: &quot;Xero App Store, captured {r.asOf}&quot;) and the reviewed
          workbook of 17 Nov 2026. Prices converted at {r.fx.source} for {r.fx.date}.
        </p>

        <h2 id="matches">Matches to check ({r.unsure.length})</h2>
        <p>
          Each Xero listing below might be the same product as an app already in our catalogue, but the match isn&apos;t certain. For each one, tell us{" "}
          <b>same product</b> or <b>different product</b>. Until then the listing is still a candidate on its own and the catalogue app keeps its own
          entry.
        </p>
        {r.unsure.length === 0 && <p className="note">All matches have been checked. Nothing to look at here.</p>}
        {r.unsure.map((u) => (
          <section key={u.listing.listing_id} className="card">
            <div className="card-head">
              <h3>
                {u.listing.name} <span className="muted small">({u.listing.listing_id})</span>
              </h3>
            </div>
            <div className="two-col">
              <div>
                <p className="stat-label">Xero listing</p>
                <p>
                  {u.listing.source_url ? (
                    <a href={u.listing.source_url} target="_blank" rel="noreferrer">
                      {u.listing.source_url}
                    </a>
                  ) : (
                    "no listing"
                  )}
                  <br />
                  Website: {u.listing.website ?? "–"}
                  <br />
                  Xero categories: {u.listing.xero_categories.join(", ") || "–"}
                  <br />
                  Our categories: {u.categories.map((c) => r.catLabel.get(c) ?? c).join(", ") || "–"}
                  <br />
                  Rating:{" "}
                  {u.listing.rating_avg !== null ? `${u.listing.rating_avg} from ${u.listing.review_count} reviews` : `no rating (${u.listing.review_count ?? 0} reviews)`}
                  <br />
                  Markets: {u.listing.markets.join(", ") || "–"}
                </p>
                {u.listing.pricing_tiers.length > 0 && (
                  <ul className="plain small">
                    {u.listing.pricing_tiers.map((t, i) => (
                      <li key={i}>{tierText(t)}</li>
                    ))}
                  </ul>
                )}
                {u.listing.description && <p className="small muted">{u.listing.description.slice(0, 280)}{u.listing.description.length > 280 ? "…" : ""}</p>}
              </div>
              <div>
                <p className="stat-label">Possible catalogue match</p>
                {u.candidates.map((c) => (
                  <p key={c.appId}>
                    <b>{c.name}</b> <span className="muted small">({c.appId})</span>
                    <br />
                    Website: {c.website ?? "–"}
                    <br />
                    Our categories: {c.categories.map((x) => r.catLabel.get(x) ?? x).join(", ")}
                    <br />
                    Markets: {c.markets.join(", ")}
                    <br />
                    <span className="muted small">Why unsure: {c.why}</span>
                  </p>
                ))}
              </div>
            </div>
          </section>
        ))}

        <h2 id="weights">Weights</h2>
        <p>
          The top four weights were decided on 9 Nov. The split inside <b>fit</b> and <b>quality</b>: {s.status.sub_weights}. A missing input scores{" "}
          {s.neutral} (neutral) and is shown as missing.
        </p>
        <pre className="small">
          {`match   = 100 × (strength × ${s.weights.strength} + fit × ${s.weights.fit} + quality × ${s.weights.quality} + price × ${s.weights.price})
fit     = integration_fit × ${s.fit.integration_fit} + job_fit × ${s.fit.job_fit}
job_fit = category_match × ${s.job_fit.category_match} + function_match × ${s.job_fit.function_match} + keyword_match × ${s.job_fit.keyword_match}
quality = clamp(rating_score × ${s.quality.rating_score} + volume_score × ${s.quality.volume_score} + award_boost, 0, 1)`}
        </pre>

        <p className="stat-label">Share of the final match</p>
        <div style={{ display: "flex", height: 28, border: "1px solid var(--line)", margin: "4px 0 8px" }} aria-hidden="true">
          {leaves.map((w, i) => (
            <div
              key={w.key}
              title={`${w.label}: ${pct(w.share)}`}
              style={{ width: `${w.share * 100}%`, background: i % 2 ? "var(--surface)" : "var(--paper)", borderRight: "1px solid var(--line)", fontSize: 11, overflow: "hidden", whiteSpace: "nowrap", padding: "6px 4px" }}
            >
              {pct(w.share)}
            </div>
          ))}
        </div>
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Part</th>
                <th className="num">Weight within its group</th>
                <th className="num">Share of the match</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {r.weights.map((w) => (
                <tr key={w.key}>
                  <td style={{ paddingLeft: w.parent === null ? undefined : w.parent === "fit" || w.parent === "quality" ? 24 : 48 }}>{w.parent === null ? <b>{w.label}</b> : w.label}</td>
                  <td className="num">{w.weight.toFixed(2)}</td>
                  <td className="num">{pct(w.share)}</td>
                  <td>{w.status === "proposed" ? <span className="tag">proposed</span> : w.parent === null ? "decided 9 Nov" : "approved 23 Nov"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Inputs and settings</h3>
        <div className="table-scroll">
          <table className="tbl">
            <tbody>
              <tr>
                <td>Category match</td>
                <td>
                  {s.category_match.covered_by} if the app is in a category that handles the line; {s.category_match.app_categories_only} if it only helps; otherwise not a
                  candidate
                </td>
              </tr>
              <tr>
                <td>Xero function match</td>
                <td>share of the rule&apos;s required Xero functions the app lists, plus {s.function_match.helpful_factor} × share of helpful ones, capped at 1</td>
              </tr>
              <tr>
                <td>Keyword match</td>
                <td>BM25 of the rule&apos;s keywords against the app&apos;s description, scaled by the best in the category (no AI)</td>
              </tr>
              <tr>
                <td>Industry fit</td>
                <td>
                  1 if the Xero listing names the business&apos;s industry; {s.industry_fit.broad_only} if it names only general ones (Professional services,
                  Accounting); an app built only for other industries (e.g. Automotive for a restaurant) is left out with the reason shown. Missing when the
                  business&apos;s industry isn&apos;t set or Xero has no matching industry (SaaS, wholesale). Map: catalog/industry-map.yaml
                </td>
              </tr>
              <tr>
                <td>Rating</td>
                <td>Bayesian average with a prior of {s.rating_prior_count} reviews at the category&apos;s mean rating, so 5.0 from 2 reviews ranks below 4.6 from 400</td>
              </tr>
              <tr>
                <td>Review volume</td>
                <td>log(1 + reviews) ÷ log(1 + most reviews in the category)</td>
              </tr>
              <tr>
                <td>Xero Awards boost</td>
                <td>
                  winner +{s.award_boost.winner}, finalist +{s.award_boost.finalist}, halving every {s.award_boost.half_life_years} year, capped at +{s.award_boost.cap}; awards whose
                  region isn&apos;t stated count as global (decided 23 Nov)
                </td>
              </tr>
              <tr>
                <td>Price</td>
                <td>
                  annual cost in £ (converted, decided 23 Nov) ≤ {pct(s.price.price_share_good)} of annual revenue scores 1, falling to 0 at {pct(s.price.price_share_bad)}; quote-only or
                  no £ price scores {s.neutral}. <a href="#price">Full method</a>
                </td>
              </tr>
              <tr>
                <td>Integration fit</td>
                <td>
                  native {s.integration_fit.native}, via another app {s.integration_fit.via_app}, CSV {s.integration_fit.csv}, none {s.integration_fit.none}, no apps kept{" "}
                  {s.integration_fit.no_apps}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="meta">Source: catalog/rules.yaml → scoring_v2. Changing a number there changes this page.</p>

        <h3 id="price">How the price score is worked out</h3>
        <ol className="plain">
          <li>
            <b>Prices:</b> each app&apos;s plans come from the vendor&apos;s pricing page (the reviewed workbook, checked 17 Nov 2026). Prices in another
            currency are converted to £ at {r.fx.source} for {r.fx.date}; the vendor&apos;s own figure is kept next to it. Free trials, plans with no
            billing period, per-transaction plans and prices that only say &quot;$&quot; are left out (never guessed).
          </li>
          <li>
            <b>The business&apos;s revenue for a year:</b> revenue so far this financial year × 12 ÷ months so far (e.g. £700k after 7 months →
            £1.2m).
          </li>
          <li>
            <b>The plan we can cost:</b> a per-business plan is its monthly price × 12 (yearly and one-off prices as they are). Per-user or
            per-employee plans need the headcount, which we don&apos;t hold yet, so they can&apos;t be costed. Usage-priced plans can&apos;t either. Of
            the plans we can cost, the <b>cheapest paid plan</b> is used (a free plan only if there&apos;s no paid one). The listings don&apos;t say
            which plan a business this size needs, so the trace names the plan used.
          </li>
          <li>
            <b>Share of revenue</b> = that plan&apos;s cost for a year ÷ the year&apos;s revenue.
          </li>
          <li>
            <b>Score:</b> {pct(s.price.price_share_good)} of revenue or less → 1. {pct(s.price.price_share_bad)} or more → 0. In between, a straight
            line: score = 1 − (share − {s.price.price_share_good}) ÷ ({s.price.price_share_bad} − {s.price.price_share_good}).
          </li>
          <li>
            <b>Missing</b> (scores {s.neutral}, shown as missing): no plans published, quote-only, only per-user or usage plans, or no revenue yet.
          </li>
          <li>
            <b>Weight:</b> price is {pct(s.weights.price)} of the match, so it adds 0 to {(100 * s.weights.price).toFixed(1)} points (missing adds{" "}
            {(100 * s.weights.price * s.neutral).toFixed(1)}).
          </li>
        </ol>
        <p className="stat-label">Worked examples: a business with £1.2m revenue a year</p>
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Plan</th>
                <th className="num">Cost a year</th>
                <th className="num">Share of revenue</th>
                <th className="num">Score</th>
                <th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["£50 a month, per business", 600],
                ["£200 a month, per business", 2400],
                ["£1,000 a month, per business", 12000],
                ["£2,000 a month, per business", 24000],
              ].map(([label, cost]) => {
                const share = (cost as number) / 1_200_000;
                const g = s.price.price_share_good;
                const b = s.price.price_share_bad;
                const score = share <= g ? 1 : share >= b ? 0 : 1 - (share - g) / (b - g);
                return (
                  <tr key={label as string}>
                    <td>{label}</td>
                    <td className="num">£{(cost as number).toLocaleString("en-GB")}</td>
                    <td className="num">{(share * 100).toFixed(2)}%</td>
                    <td className="num">{score.toFixed(2)}</td>
                    <td className="num">{(100 * s.weights.price * score).toFixed(1)}</td>
                  </tr>
                );
              })}
              <tr>
                <td>Quote only / not published (e.g. Chaser)</td>
                <td className="num">–</td>
                <td className="num">–</td>
                <td className="num">{s.neutral.toFixed(2)} (missing)</td>
                <td className="num">{(100 * s.weights.price * s.neutral).toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="meta">
          {r.prices.withGbp} of {r.count.listings} apps have a £ price today, so most apps score &quot;missing&quot; on price. Thresholds: catalog/rules.yaml →
          scoring_v2.price; code: lib/rank/v2/price.ts.
        </p>

        <h2 id="categories">Xero categories → our categories</h2>
        <p>
          How the category Xero files an app under makes it a candidate for a gap. <span className="tag">proposed</span> Rows with no category of ours never make an
          app a candidate on their own.
        </p>
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Xero App Store category</th>
                <th className="num">Apps</th>
                <th>Our categories</th>
              </tr>
            </thead>
            <tbody>
              {r.categoryRows.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td className="num">{c.listings}</td>
                  <td>{c.ours.join(", ") || <span className="muted">none</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.combos.map((c, i) => (
          <p key={i} className="meta">
            An app in both {c.all.join(" and ")} counts as {c.add.join(", ")}, not {c.drop.join(", ")} (Xero files rota and timesheet apps under both).
          </p>
        ))}

        <h2 id="fx">Exchange rates used</h2>
        <p className="meta">
          {r.fx.source}, {r.fx.date}:{" "}
          {Object.entries(r.fx.rates)
            .filter(([k]) => k !== "GBP" && k !== r.fx.base)
            .map(([k, v]) => `1 ${k} = £${(r.fx.rates.GBP! / v).toFixed(4)}`)
            .join(" · ")}
          {` · 1 EUR = £${r.fx.rates.GBP!.toFixed(4)}`}. Prices with no stated currency (&quot;$&quot; only) aren&apos;t converted.
        </p>
      </main>
    </>
  );
}
