import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/session";
import { flaggedLines, kpiView, summaryView } from "@/lib/read/views";
import { RefreshButton } from "@/components/refresh-button";
import { AppQuestions } from "@/components/app-questions";
import { appQuestions } from "@/lib/detect/status";
import { apps as catalogApps } from "@/lib/catalog/load";
import { gbp, KIND_LABEL, lineHref, pct, when } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

/** Where the Xero callback lands: the diagnosis summary and the lines worth a look. */
export default async function OrgPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireOrgMember(org);
  } catch {
    return null; // the layout shows sign-in / not found
  }
  const s = await summaryView(org);
  if (!s) return null;
  const run = s.lastRun;
  const top = s.ready ? await flaggedLines(org) : [];
  const k = s.ready ? await kpiView(org) : null;
  const questions = s.ready ? await appQuestions(org) : [];

  return (
    <>
      <RefreshButton org={org} busy={run?.status === "running"} />
      {run?.finishedAt ? (
        <p className="meta">
          Last refreshed {when(run.finishedAt)}
          {run.status !== "ok" ? <> · finished with status <b>{run.status}</b></> : null}
        </p>
      ) : null}

      {!s.ready ? (
        <p>First refresh {run ? <>is <b>{run.status}</b></> : "hasn't started"}. Reload in a few seconds.</p>
      ) : (
        <>
          <section className="stats" aria-label="Summary">
            <div className="stat">
              <span className="stat-label">At stake</span>
              <span className="stat-num mark">{gbp(s.atStake?.value ?? 0)}</span>
              <span className="stat-sub">on lines worth a look</span>
            </div>
            <div className="stat">
              <span className="stat-label">Lines to look at</span>
              <span className="stat-num">{s.lines?.flagged ?? 0}</span>
              <span className="stat-sub">of {s.lines?.total ?? 0} lines</span>
            </div>
            <div className="stat">
              <span className="stat-label">Covered</span>
              <span className="stat-num">{s.lines?.covered ?? 0}</span>
              <span className="stat-sub">by apps you already use</span>
            </div>
            <div className="stat">
              <span className="stat-label">Being checked</span>
              <span className="stat-num">{s.lines?.queued ?? 0}</span>
              <span className="stat-sub">by our team</span>
            </div>
          </section>

          {k ? (
            <section className="kpis" aria-label="Headline ratios">
              <h2>Year to date</h2>
              <dl className="totals">
                <div>
                  <dt>Gross margin</dt>
                  <dd className="num">{k.grossMargin === null ? "n/a" : pct(k.grossMargin)}</dd>
                </div>
                <div>
                  <dt>Staff costs</dt>
                  <dd className="num">{k.labourShare === null ? "n/a" : pct(k.labourShare)}</dd>
                </div>
                <div>
                  <dt>Net profit</dt>
                  <dd className="num">{k.netShare === null ? "n/a" : pct(k.netShare)}</dd>
                </div>
              </dl>
              <p className="muted small">
                Shares of revenue ({gbp(k.revenue)}). Staff costs are wages, employer&apos;s NI, pensions and other staff costs; contractors aren&apos;t
                included. &quot;n/a&quot; means those accounts aren&apos;t in your figures.
              </p>
            </section>
          ) : null}

          <AppQuestions org={org} questions={questions} apps={catalogApps().map((a) => ({ id: a.id, name: a.name })).sort((x, y) => x.name.localeCompare(y.name))} />

          <h2>Lines worth a look</h2>
          {top.length === 0 ? (
            <p className="muted">Nothing stands out on your latest figures.</p>
          ) : (
            <ul className="cards">
              {top.map((l) => (
                <li key={l.key} className="card">
                  <Link href={lineHref(org, l.key)} className="card-link">
                    <span className="card-head">
                      <b>{l.name}</b>
                      <span className="num">{gbp(l.value)}</span>
                    </span>
                    <span className="muted small">
                      {KIND_LABEL[l.statement]} · {pct(l.materiality)} of {l.statement === "bs" ? "total assets" : "revenue"}
                    </span>
                    {l.cause ? <span className="small">{l.cause}</span> : null}
                    {l.topApp ? (
                      <span className="small">
                        Best match: <b>{l.topApp.name}</b> ({l.topApp.match}% match)
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <h2>Apps we found in your ledger</h2>
          {s.appsInUse?.length ? (
            <ul className="plain">
              {s.appsInUse.map((a) => (
                <li key={a.id}>
                  <b>{a.name}</b>{" "}
                  <span className="muted small">
                    · {gbp(a.spend12m)} in the last 12 months · seen in {a.monthsSeen} months
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None detected from your supplier bills yet.</p>
          )}
          <p className="muted small">
            App details are draft catalogue entries that a person hasn&apos;t checked yet. Any price shown comes from the vendor&apos;s own site, with the page it came from. <Link href="/apps">All apps</Link>
          </p>
        </>
      )}
    </>
  );
}
