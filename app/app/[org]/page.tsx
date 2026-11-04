import { HttpError } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { summaryView } from "@/lib/read/views";

export const dynamic = "force-dynamic";

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

/**
 * Where the Xero callback lands. A plain status page so a connect can be checked end to end;
 * the real UI (flowstack-ledger.html) gets wired to the API later.
 */
export default async function OrgPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireOrgMember(org);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      return (
        <main className="wrap">
          <p>Sign in to see this organisation.</p>
          <p><a href="/api/auth/xero/start">Sign in with Xero</a></p>
        </main>
      );
    }
    return <main className="wrap"><p>Not found.</p></main>;
  }
  const s = await summaryView(org);
  if (!s) return <main className="wrap"><p>Not found.</p></main>;
  return (
    <main className="wrap">
      <h1>{s.org.name}{s.sample ? <span className="tag">sample</span> : null}</h1>
      {!s.ready ? (
        <p>
          First refresh {s.lastRun ? <>is <b>{s.lastRun.status}</b></> : "hasn't started"}. Reload in a few seconds.
          {s.lastRun && "id" in s.lastRun ? <> · <a href={`/api/orgs/${org}/refresh/${s.lastRun.id}`}>progress</a></> : null}
        </p>
      ) : (
        <>
          <p className="hero">
            <span className="num">{gbp(s.atStake?.value ?? 0)}</span> at stake
          </p>
          <p>
            {s.lines?.flagged} flagged · {s.lines?.covered} covered · {s.lines?.queued} being checked · {s.lines?.total} lines
          </p>
          <p>Apps in use: {s.appsInUse?.map((a) => a.name).join(", ") || "none detected"}</p>
          <ul>
            <li><a href={`/api/orgs/${org}/statements/pl`}>Profit and loss</a></li>
            <li><a href={`/api/orgs/${org}/statements/bs`}>Balance sheet</a></li>
            <li><a href={`/api/orgs/${org}/statements/cf`}>Cash flow (derived)</a></li>
            <li><a href={`/api/orgs/${org}/summary`}>Summary JSON</a></li>
          </ul>
        </>
      )}
    </main>
  );
}
