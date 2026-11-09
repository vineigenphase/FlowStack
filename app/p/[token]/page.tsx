import { notFound } from "next/navigation";
import { proposalByToken } from "@/lib/firms";
import { ProposalChooser } from "@/components/practice-forms";
import { gbp } from "@/lib/ui/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposal", robots: { index: false, follow: false } };

/**
 * Client proposal (CLAUDE.md §1 Firm UX 4): branded with the firm's name, fixes in order with the ledger lines
 * behind each, the client ticks what to go ahead with. The fee is the firm's, shown as written.
 * Hours saved need transaction volumes, which 1.0 doesn't read (BACKEND D7), so we show £ at stake instead.
 */
export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await proposalByToken(token);
  if (!row) notFound();
  const { p } = row;
  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          <span className="brand">{row.firmName}</span>
          <span className="org-name">
            for {row.orgName}
            {row.sample ? <span className="tag">sample data</span> : null}
          </span>
        </div>
      </header>
      <main className="wrap">
        <h1>Fixes for your finance stack</h1>
        <p className="meta">
          From your own Xero figures. Each step is numbered, biggest £ first: add an app where nothing does the job, or change one where another fits better.
        </p>
        <ol className="fixes">
          {p.items.map((i) => (
            <li key={i.n}>
              <span className="fix-n num">{i.n}</span>
              <div>
                <b>{i.title}</b>
                {i.atStake ? <span className="num"> · {gbp(i.atStake)} at stake</span> : null}
                <span className="small block">{i.why}</span>
                <span className="muted small block">From your accounts: {i.lines.join(", ")}</span>
              </div>
            </li>
          ))}
        </ol>
        {p.feeText ? (
          <section className="note">
            <h2>{row.firmName}&apos;s fee</h2>
            <p>{p.feeText}</p>
          </section>
        ) : null}
        <ProposalChooser token={token} items={p.items.map((i) => ({ n: i.n, title: i.title, atStake: i.atStake }))} initial={p.chosen} answered={p.status === "accepted"} />
        <p className="muted small">
          &quot;At stake&quot; is the year-to-date cost on lines no app handles yet, not a promise of savings. No app pays to appear in these
          recommendations. Prepared with FlowStack.
        </p>
      </main>
    </>
  );
}
