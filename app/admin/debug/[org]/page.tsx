import { desc, eq, sql } from "drizzle-orm";
import { HttpError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { withOrg } from "@/lib/db/client";
import { orgs, recommendationsV2, syncRuns } from "@/db/schema";
import { SiteHeader } from "@/components/site-header";
import { DevMount } from "@/components/dev/dev-mount";
import { DevLinks } from "@/components/dev/dev-links";
import { orgLinks } from "@/lib/dev/links";
import { panelLines } from "@/lib/dev/lines";
import { AdminSignIn } from "@/components/admin-sign-in";

export const dynamic = "force-dynamic";
export const metadata = { title: "Debug · FlowStack" };

const when = (d: Date | null) => (d ? new Date(d).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }) : "–");
const kb = (n: number | undefined) => (n === undefined ? "–" : `${Math.round(n / 1024).toLocaleString("en-GB")} KB`);

/** ENGINE-V2 §2.2 "Debug (this business)": recent refreshes, per-step Xero calls and bytes, engine v2 shadow rows. Admins only. */
export default async function DebugPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return (
      <>
        <SiteHeader />
        <main className="wrap">
          <h1>Debug</h1>
          <AdminSignIn next={`/admin/debug/${org}`} />
        </main>
      </>
    );
  }
  if (!/^[0-9a-f-]{36}$/.test(org)) return null;
  const { o, runs, v2 } = await withOrg(org, async (tx) => ({
    o: (await tx.select({ name: orgs.name, industry: orgs.industry, markets: orgs.markets, sample: orgs.sample }).from(orgs).where(eq(orgs.id, org)))[0],
    runs: await tx.select().from(syncRuns).where(eq(syncRuns.orgId, org)).orderBy(desc(syncRuns.startedAt)).limit(5),
    v2: (await tx.select({ n: sql<number>`count(*)::int` }).from(recommendationsV2).where(eq(recommendationsV2.orgId, org)))[0]?.n ?? 0,
  }));
  return (
    <>
      <SiteHeader />
      <DevMount org={org} />
      <main className="wrap">
        <h1>Debug: {o?.name ?? "unknown business"}</h1>
        <p className="meta">
          {o?.sample ? "Sample data · " : ""}Industry: {o?.industry ?? "not set"} · Markets: {o?.markets.join(", ") ?? "–"} · Engine v2 shadow rows: {v2}
        </p>
        <p className="small">
          <a href={`/app/${org}`}>Open the business</a> · <a href="/admin/links">All dev links</a>
        </p>
        <details className="card" id="links">
          <summary>
            <b>Links for this business</b> <span className="muted small">(copy and paste)</span>
          </summary>
          <DevLinks groups={orgLinks(org, await panelLines(org))} />
        </details>
        <h2>Last refreshes</h2>
        {runs.length === 0 ? (
          <p className="muted">No refreshes yet.</p>
        ) : (
          runs.map((r) => (
            <section key={r.id} className="card">
              <span className="card-head">
                <b>
                  {when(r.startedAt)} · {r.status}
                </b>
                <span className="muted small">
                  {r.finishedAt ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)} s · ` : ""}
                  {r.calls} Xero calls · {kb(r.egressBytes)}
                </span>
              </span>
              {r.error ? <p className="dev-error small">{r.error}</p> : null}
              <div className="table-scroll">
                <table className="tbl small">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Status</th>
                      <th className="num">Calls</th>
                      <th className="num">Data</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.steps.map((s) => (
                      <tr key={s.key}>
                        <td>{s.key}</td>
                        <td>{s.status}</td>
                        <td className="num">{s.calls ?? "–"}</td>
                        <td className="num">{kb(s.bytes)}</td>
                        <td>{s.error ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">Run {r.id}</p>
            </section>
          ))
        )}
      </main>
    </>
  );
}
