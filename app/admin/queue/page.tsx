import { HttpError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { accountCategories, apps } from "@/lib/catalog/load";
import { queueView } from "@/lib/queue/view";
import { ROLES, SCORE_LABELS } from "@/lib/reviews";
import { SiteHeader } from "@/components/site-header";
import { QueueActions } from "@/components/queue-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review queue · FlowStack" };

const day = (d: Date) => new Date(d).toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "medium" });
const SITUATION: Record<string, string> = { industry: "Industry", sizeBand: "Size", markets: "Markets", sites: "Sites", headcount: "Headcount", keeps: "Keeps", mustHaves: "Must-haves" };

/** Our team's queue (BACKEND.md §9): reviews to check, quote requests to send, mappings and facts to confirm. */
export default async function QueuePage() {
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return (
      <>
        <SiteHeader />
        <main className="wrap"><h1>Review queue</h1><p>This page is for the FlowStack team.</p></main>
      </>
    );
  }
  const groups = await queueView();
  const categories = accountCategories().map((c) => ({ value: c.key, label: c.label }));
  const appOpts = apps().map((a) => ({ value: a.id, label: a.name })).sort((a, b) => a.label.localeCompare(b.label));
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <h1>Review queue</h1>
        <p className="meta">{total ? `${total} open, oldest first. Every decision is recorded with your name.` : "Nothing waiting."}</p>
        {groups.length ? (
          <nav className="chips" aria-label="Kinds">
            {groups.map((g) => <a key={g.kind} href={`#${g.kind}`}>{g.label} ({g.items.length})</a>)}
          </nav>
        ) : null}
        {groups.map((g) => (
          <section key={g.kind} id={g.kind}>
            <h2>{g.label}</h2>
            <ol className="plain queue-list">
              {g.items.map((i) => (
                <li key={i.id} className="card">
                  <span className="card-head">
                    <b>{i.review ? i.review.appName : i.quote ? i.quote.appNames.join(", ") : (i.orgName ?? String(i.ref.app_id ?? "Catalogue"))}</b>
                    <span className="muted small">{i.orgName ? `${i.orgName} · ` : ""}{day(i.createdAt)}</span>
                  </span>
                  <span className="small">
                    {i.priority === "high" ? <b className="badge">High priority</b> : null} {i.reason}
                  </span>
                  {i.review ? (
                    <blockquote className="queue-quote">
                      <span className="small muted block">
                        {ROLES.find((r) => r.key === i.review!.role)?.label ?? i.review.role} · paid for it {i.review.verifiedMonths} months
                        {i.review.sample ? " · sample org: never public" : ""}
                      </span>
                      <span className="small muted block">
                        {Object.entries(SCORE_LABELS).map(([k, l]) => `${l} ${i.review!.scores[k] ?? "–"}/5`).join(" · ")}
                      </span>
                      {i.review.body}
                    </blockquote>
                  ) : null}
                  {i.quote ? (
                    <dl className="queue-situation small">
                      {Object.entries(i.quote.situation).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
                        <div key={k}><dt>{SITUATION[k] ?? k}</dt><dd>{Array.isArray(v) ? v.join(", ") || "–" : String(v)}</dd></div>
                      ))}
                      <div><dt>Replies to</dt><dd>{i.quote.replyTo}</dd></div>
                    </dl>
                  ) : null}
                  {!i.review && !i.quote ? (
                    <details className="small">
                      <summary>Details</summary>
                      <pre className="queue-ref">{JSON.stringify(i.ref, null, 2)}</pre>
                    </details>
                  ) : null}
                  <QueueActions id={i.id} actions={i.actions} field={typeof i.ref.field === "string" ? i.ref.field : undefined} categories={categories} apps={appOpts} />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </main>
    </>
  );
}
