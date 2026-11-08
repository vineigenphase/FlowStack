import Link from "next/link";
import { digest, requireFirmMember } from "@/lib/firms";
import { gbp } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

/** The Monday digest (CLAUDE.md §1 Firm UX 6), as a page. Sending it by email or Slack needs a provider. */
export default async function DigestPage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm } = await params;
  try {
    await requireFirmMember(firm);
  } catch {
    return null;
  }
  const d = await digest(firm);
  return (
    <>
      <h1>Monday digest</h1>
      <p className="meta">The last 7 days across your clients.</p>

      <h2>Wins</h2>
      {d.wins.length ? (
        <ul className="plain">
          {d.wins.map((w, i) => (
            <li key={i}>
              <Link href={`/app/${w.org}/after`}>{w.name}</Link>: {w.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No check-ins passed this week.</p>
      )}

      <h2>Clients that need you</h2>
      {d.needPartner.length ? (
        <ul className="plain">
          {d.needPartner.map((c) => (
            <li key={c.orgId}>
              <Link href={`/practice/${firm}/clients/${c.orgId}`}>{c.name}</Link>
              <span className="muted small">
                {" "}
                · {[
                  c.failedChecks ? `${c.failedChecks} check-in${c.failedChecks === 1 ? "" : "s"} need a look` : null,
                  c.atStake && !c.proposal ? `${gbp(c.atStake)} at stake, no proposal yet` : null,
                  c.drift.length ? `off playbook in ${c.drift.length} job${c.drift.length === 1 ? "" : "s"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing needs you this week.</p>
      )}

      <h2>Proposals waiting</h2>
      {d.waiting.length ? (
        <ul className="plain">
          {d.waiting.map(({ p, orgName }) => (
            <li key={p.id}>
              <Link href={`/practice/${firm}/clients/${p.orgId}`}>{orgName}</Link>
              <span className="muted small"> · sent {p.sentAt?.toISOString().slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No proposals waiting for an answer.</p>
      )}
      {d.acceptedThisWeek.length ? (
        <>
          <h2>Answered this week</h2>
          <ul className="plain">
            {d.acceptedThisWeek.map(({ p, orgName }) => (
              <li key={p.id}>
                {orgName}: {p.chosen.length} of {p.items.length} fixes
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="muted small">Email and Slack delivery aren&apos;t switched on yet.</p>
    </>
  );
}
