import Link from "next/link";
import { requireOrgReader } from "@/lib/auth/session";
import { guestAnswers } from "@/lib/demo";
import { lineView } from "@/lib/read/views";
import { FeedbackButtons } from "@/components/feedback-buttons";
import { PostButton } from "@/components/post-button";
import { isPriority, PRIORITIES, rankByPriority } from "@/lib/rank/priority";
import { priorityInputs } from "@/lib/rank/priority-data";
import { orgQuotes, situationFor } from "@/lib/quotes";
import { QuoteForm } from "@/components/quote-form";
import { gbp, KIND_LABEL, pct, STATE_LABEL } from "@/lib/ui/format";

import { apps as catalogApps } from "@/lib/catalog/load";
import { devToolsOn, needsPersonLines } from "@/lib/dev/tools";
export const dynamic = "force-dynamic";

type Evidence = {
  base_label?: string;
  base_value?: number;
  switch_option?: { app: string; match: number; in_use_match: number; reason: string };
  /** Round-2 3c: most of this year's value sits in one month. */
  one_off?: { month: string; share: number; note: string };
};

export default async function LinePage({ params, searchParams }: { params: Promise<{ org: string; lineKey: string }>; searchParams: Promise<{ priority?: string }> }) {
  const { org, lineKey } = await params;
  const { priority: pq } = await searchParams;
  const priority = isPriority(pq) ? pq : null;
  let guestId: string | null = null;
  try {
    guestId = (await requireOrgReader(org)).guestId;
  } catch {
    return null;
  }
  const l = await lineView(org, decodeURIComponent(lineKey));
  if (!l) {
    return (
      <>
        <h1>Line not found</h1>
        <p><Link href={`/app/${org}`}>Back to summary</Link></p>
      </>
    );
  }
  // A /demo guest sees their own answer (kept 24 hours); the shared sample business is never changed.
  const mine = guestId ? (await guestAnswers(guestId)).get(l.flagId) : undefined;
  if (mine?.state) l.state = mine.state as typeof l.state;
  const ev = l.evidence as Evidence;
  // Priority presets re-rank the same shortlist; the default order is the standard match.
  const ranked = priority ? rankByPriority(await priorityInputs(l.recommendations.map((r) => ({ appId: r.app.id, name: r.app.name, match: r.match }))), priority) : null;
  const recs = ranked ? ranked.map((x) => ({ ...l.recommendations.find((r) => r.app.id === x.appId)!, p: x })) : l.recommendations.map((r) => ({ ...r, p: null }));
  const here = `/app/${org}/lines/${encodeURIComponent(l.key)}`;
  const trend = (l.evidence as { trend?: { key: string; latest: number | null; three_months_ago: number | null; formula: string; series: { end: string; value: number | null }[] } }).trend ?? null;
  const quoteApps = l.recommendations.filter((r) => !r.inUse).map((r) => ({ id: r.app.id, name: r.app.name }));
  const [quotes, situation] = await Promise.all([orgQuotes(org, l.key), quoteApps.length ? situationFor(org, {}) : null]);
  // ENGINE-V2 §2.2: admins with dev tools see when this line needs a person.
  const person = (await devToolsOn()) && (l.state === "queued" || (await needsPersonLines(org)).has(l.key));

  return (
    <>
      <p className="meta">
        {l.statement === "trend" ? <Link href={`/app/${org}`}>← Summary</Link> : <Link href={`/app/${org}/statements/${l.statement}`}>← {KIND_LABEL[l.statement]}</Link>}
      </p>
      <h1>
        {l.name}
        {l.code ? <span className="muted"> {l.code}</span> : null}
      </h1>
      <p>
        <span className={`badge b-${l.state}`}>{STATE_LABEL[l.state] ?? l.state}</span>
        {person ? <span className="needs-person-badge">Needs a person</span> : null}
        {l.section ? <span className="muted small"> · {l.section}</span> : null}
      </p>
      {ev.one_off ? <p className="note small">{ev.one_off.note}</p> : null}

      <dl className="totals">
        <div>
          <dt>Amount</dt>
          <dd className="num">{gbp(l.value)}</dd>
        </div>
        <div>
          <dt>Share of {(ev.base_label ?? "base").toLowerCase()}</dt>
          <dd className="num">{pct(l.materiality)}</dd>
        </div>
        {ev.base_value ? (
          <div>
            <dt>{ev.base_label}</dt>
            <dd className="num">{gbp(ev.base_value)}</dd>
          </div>
        ) : null}
      </dl>

      {l.cause ? (
        <>
          <h2>Why we flagged it</h2>
          <p>{l.cause}</p>
        </>
      ) : null}

      {trend ? (
        <section className="trend">
          <h2>The last 12 months</h2>
          <p className="small">
            {trend.key === "cash_headroom_months" ? "Months of cash left" : "Days"}: <b className="num">{trend.latest}</b> now, <span className="num">{trend.three_months_ago}</span> three
            months ago. Worked out as {trend.formula}.
          </p>
          <div className="table-scroll">
            <table className="trend-table">
              <thead>
                <tr>{[...trend.series].reverse().map((p) => <th key={p.end} scope="col">{new Date(p.end).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" })}</th>)}</tr>
              </thead>
              <tbody>
                <tr>{[...trend.series].reverse().map((p) => <td key={p.end} className="num">{p.value ?? "–"}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">A dash means there weren&apos;t three months of figures before that month to work it out from.</p>
        </section>
      ) : null}

      {l.state === "queued" ? (
        <p className="note warn">
          We can&apos;t tell what this account is for yet, so a person on our team is checking it. We won&apos;t recommend anything until then.
        </p>
      ) : null}

      {l.flagId && ["flagged", "covered", "marked_fine", "snoozed", "queued"].includes(l.state) && l.ruleId ? (
        <FeedbackButtons flagId={l.flagId} state={l.state} apps={catalogApps().map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name))} />
      ) : null}

      {l.detectedInArea.length ? (
        <>
          <h2>What you already use for this</h2>
          <ul className="plain">
            {l.detectedInArea.map((d) => (
              <li key={d.id}>
                <b>{d.name}</b>{" "}
                <span className="muted small">
                  · {gbp(d.spend12m)} in the last 12 months · seen in {d.monthsSeen} months{d.present ? "" : " · no recent bills"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {ev.switch_option ? (
        <p className="note">
          Another app scores higher here than the one you use ({ev.switch_option.match}% vs {ev.switch_option.in_use_match}%):{" "}
          {ev.switch_option.reason}.
        </p>
      ) : null}

      {l.recommendations.length ? (
        <>
          <h2>Apps that fit</h2>
          <nav className="chips" aria-label="What matters most">
            <Link href={here} aria-current={!priority ? "page" : undefined}>Best fit</Link>
            {(Object.keys(PRIORITIES) as (keyof typeof PRIORITIES)[]).map((k) => (
              <Link key={k} href={`${here}?priority=${k}`} aria-current={priority === k ? "page" : undefined}>
                {PRIORITIES[k].label}
              </Link>
            ))}
          </nav>
          <ol className="cards">
            {recs.map((r) => (
              <li key={r.app.id} className="card">
                <span className="card-head">
                  <b>
                    {r.app.name}
                    {r.inUse ? <span className="tag">you use this</span> : r.kind === "change" ? <span className="tag">change</span> : r.kind === "add" ? <span className="tag">add</span> : null}
                    {r.app.sample ? <span className="tag">draft entry</span> : null}
                  </b>
                  <span className="num">{r.p ? `${r.p.score}% for ${PRIORITIES[priority!].label.toLowerCase()}` : `${r.match}% match`}</span>
                </span>
                <span className="small">{r.reason}</span>
                {r.p ? <span className="small muted">{r.p.why}</span> : null}
                <span className="card-actions small">
                  <Link href={`/apps/${r.app.id}`}>Prices, contract and security</Link>
                  {r.inUse ? null : (
                    <PostButton
                      url={`/api/orgs/${org}/installs`}
                      payload={{ appId: r.app.id, lineKey: l.key }}
                      label="We've started using it"
                      done="Saved. We'll check it at day 7, 30 and 90."
                    />
                  )}
                </span>
              </li>
            ))}
          </ol>
          <p className="muted small">
            {priority
              ? "Re-ranked for what matters most to you, from each vendor's published price and time to go live and verified reviews' support scores. Anything not published counts as middling, never guessed."
              : "Ranked by how strongly your figures point to this area and how well each app works with what you already use."}{" "}
            Nobody can pay to rank higher.
          </p>
        </>
      ) : null}

      {quoteApps.length || quotes.length ? (
        <section>
          <h2>Quotes</h2>
          {quotes.map((q) => (
            <div key={q.id} className="card">
              <span className="muted small">
                Asked {q.createdAt.toISOString().slice(0, 10)} · {q.sentAt ? `sent to vendors ${q.sentAt.toISOString().slice(0, 10)}` : "with our team, not sent yet"}
              </span>
              <ul className="plain">
                {q.vendors.map((v) => (
                  <li key={v.appId}>
                    <b>{v.name}</b>:{" "}
                    {v.reply ? (
                      <>
                        {v.reply.priceText}
                        {v.reply.priceMonthly !== null ? <span className="num"> ({gbp(v.reply.priceMonthly)} a month)</span> : null}
                        {Object.entries(v.reply.terms).length ? (
                          <span className="muted small"> · {Object.entries(v.reply.terms).map(([k, t]) => `${k}: ${t}`).join(" · ")}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted">no reply yet</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {quoteApps.length && !guestId ? (
            <details>
              <summary>Ask vendors for a quote</summary>
              <QuoteForm org={org} lineKey={l.key} apps={quoteApps} situation={situation!} />
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
