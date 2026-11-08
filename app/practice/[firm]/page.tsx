import Link from "next/link";
import { addableOrgs, clientsView, requireFirmMember, type ClientRow } from "@/lib/firms";
import { SEGMENT_LABEL } from "@/lib/firms/flow";
import { industryLabel } from "@/lib/orgs/settings";
import { InviteButton } from "@/components/practice-forms";
import { AskBox } from "@/components/ask-box";
import { PostButton } from "@/components/post-button";
import { gbp } from "@/lib/ui/format";
import { signInHref } from "@/lib/ui/signin";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", label: "All clients" },
  { key: "fixes_ready", label: "Fixes ready" },
  { key: "proposal_out", label: "Proposal out" },
  { key: "watching", label: "Watching" },
] as const;

function FlowBar({ c }: { c: ClientRow }) {
  if (!c.ready) return <span className="muted small">No figures yet</span>;
  return (
    <ol className="flowbar" aria-label="Money flows">
      {c.segments.map((s) => (
        <li key={s.key} className={`seg seg-${s.state}`} title={`${s.label}: ${SEGMENT_LABEL[s.state]}`}>
          <span className="seg-name">{s.label}</span>
          <span className="seg-state">{SEGMENT_LABEL[s.state]}</span>
        </li>
      ))}
    </ol>
  );
}

export default async function PracticeHome({ params, searchParams }: { params: Promise<{ firm: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { firm } = await params;
  const { filter } = await searchParams;
  let userId: string;
  try {
    userId = (await requireFirmMember(firm)).userId;
  } catch {
    return null;
  }
  const [all, addable] = await Promise.all([clientsView(firm), addableOrgs(firm, userId)]);
  const f = FILTERS.find((x) => x.key === filter)?.key ?? "";
  const clients = f ? all.filter((c) => c.tags.includes(f as ClientRow["tags"][number])) : all;
  const total = all.reduce((s, c) => s + c.atStake, 0);
  const si = signInHref(`/practice/${firm}`);

  return (
    <>
      <h1>Clients</h1>
      <p className="meta">
        Ranked by costs at stake: flagged lines with no app handling them. {all.length} clients · <b className="num">{gbp(total)}</b> at stake in all.
      </p>
      <AskBox url={`/api/firms/${firm}/ask`} across placeholder="Ask across all clients, e.g. which clients need a payroll app?" />
      <nav className="chips" aria-label="Filter">
        {FILTERS.map((x) => (
          <Link key={x.key} href={x.key ? `/practice/${firm}?filter=${x.key}` : `/practice/${firm}`} aria-current={f === x.key ? "page" : undefined}>
            {x.label} <span className="muted small">{x.key ? all.filter((c) => c.tags.includes(x.key as ClientRow["tags"][number])).length : all.length}</span>
          </Link>
        ))}
      </nav>

      {clients.length ? (
        <ol className="clients">
          {clients.map((c) => (
            <li key={c.orgId} className="client card">
              <span className="card-head">
                <b>
                  <Link href={`/practice/${firm}/clients/${c.orgId}`}>{c.name}</Link>
                  {c.sample ? <span className="tag">sample data</span> : null}
                </b>
                <span className={c.atStake ? "num mark" : "num"}>{gbp(c.atStake)}</span>
              </span>
              <span className="muted small">
                {industryLabel(c.industry) ?? "Industry not set"} · {c.fixes} fix{c.fixes === 1 ? "" : "es"}
                {c.proposal ? ` · proposal ${c.proposal.status}` : ""}
                {c.watching ? ` · ${c.watching} check-in${c.watching === 1 ? "" : "s"} to come` : ""}
                {c.failedChecks ? ` · ${c.failedChecks} check-in${c.failedChecks === 1 ? "" : "s"} need a look` : ""}
              </span>
              <FlowBar c={c} />
              {c.drift.length ? (
                <ul className="plain drift small">
                  {c.drift.map((d) => (
                    <li key={d.job}>
                      Off playbook in {d.jobLabel.toLowerCase()}: {d.kind === "different" ? `uses ${d.haveNames.join(", ")}, not ${d.wantName}` : `no ${d.wantName} yet`}
                    </li>
                  ))}
                </ul>
              ) : null}
              <span className="card-actions small">
                <Link href={`/app/${c.orgId}`}>Open their figures</Link>
                <Link href={`/app/${c.orgId}/map`}>Money flow</Link>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="note">{all.length ? "No clients match this filter." : "No clients yet. Connect a client's Xero, then add it here."}</p>
      )}

      <h2>Add a client</h2>
      <p className="muted small">
        Connect each client&apos;s Xero yourself (Xero only allows one connection at a time on our plan), then add it here. Your colleagues in the
        practice can then open it too.
      </p>
      {addable.length ? (
        <ul className="plain">
          {addable.map((o) => (
            <li key={o.id} className="inline-form">
              <span>{o.name}{o.sample ? <span className="tag">sample data</span> : null}</span>
              <PostButton url={`/api/firms/${firm}/clients`} payload={{ orgId: o.id }} label="Add to practice" />
            </li>
          ))}
        </ul>
      ) : null}
      {si.dev ? null : <p><a className="btn ghost" href="/api/auth/xero/start">Connect a client&apos;s Xero</a></p>}

      <h2>Colleagues</h2>
      <InviteButton firm={firm} />
    </>
  );
}
