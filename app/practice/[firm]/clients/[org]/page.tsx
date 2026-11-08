import Link from "next/link";
import { clientsView, firmProposals, requireFirmMember } from "@/lib/firms";
import { NewProposalButton, ProposalEditor } from "@/components/practice-forms";
import { PostButton } from "@/components/post-button";
import { env } from "@/lib/env";
import { gbp } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "Draft", sent: "Sent: waiting for the client", accepted: "Client answered", withdrawn: "Withdrawn" };

/** One client in the practice: its fixes and the proposals sent to it. */
export default async function ClientPage({ params }: { params: Promise<{ firm: string; org: string }> }) {
  const { firm, org } = await params;
  try {
    await requireFirmMember(firm);
  } catch {
    return null;
  }
  const c = (await clientsView(firm)).find((x) => x.orgId === org);
  if (!c) return <p>This client isn&apos;t in the practice. <Link href={`/practice/${firm}`}>Back</Link></p>;
  const props = (await firmProposals(firm)).filter((x) => x.p.orgId === org);
  const base = env().APP_URL.replace(/\/$/, "");

  return (
    <>
      <p className="meta"><Link href={`/practice/${firm}`}>← Clients</Link></p>
      <h1>
        {c.name}
        {c.sample ? <span className="tag">sample data</span> : null}
      </h1>
      <p className="meta">
        <b className="num">{gbp(c.atStake)}</b> at stake · {c.fixes} fixes · <Link href={`/app/${org}/map`}>money flow and fixes in order</Link> ·{" "}
        <Link href={`/app/${org}/after`}>after install</Link>
      </p>

      <h2>Proposals</h2>
      {props.length ? null : <p className="muted">None yet. A proposal lists this client&apos;s fixes in order; they tick the ones to go ahead with.</p>}
      {props.map(({ p }) => (
        <section key={p.id} className="install">
          <h3>
            {STATUS[p.status] ?? p.status} <span className="muted small">· {p.createdAt.toISOString().slice(0, 10)}</span>
          </h3>
          <ol className="plain">
            {p.items.map((i) => (
              <li key={i.n}>
                {p.status === "accepted" ? (p.chosen.includes(i.n) ? "✓ " : "✗ ") : `${i.n}. `}
                {i.title} <span className="muted small">· {gbp(i.atStake)} · {i.lines.join(", ")}</span>
              </li>
            ))}
          </ol>
          <ProposalEditor firm={firm} id={p.id} feeText={p.feeText} status={p.status} link={p.status === "sent" ? `${base}/p/${p.token}` : null} />
        </section>
      ))}
      {c.fixes && !props.some((x) => x.p.status === "draft" || x.p.status === "sent") ? <NewProposalButton firm={firm} org={org} /> : null}

      <h2>Practice</h2>
      <PostButton url={`/api/firms/${firm}/clients/${org}`} method="DELETE" label="Remove from practice" />
    </>
  );
}
