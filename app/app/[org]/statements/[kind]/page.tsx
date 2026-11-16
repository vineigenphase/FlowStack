import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgReader } from "@/lib/auth/session";
import { statementView } from "@/lib/read/views";
import { day, gbp, isKind, KIND_LABEL, lineHref, pct, STATE_LABEL } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type Line = {
  key: string;
  code: string | null;
  name: string;
  value: number;
  share: number | null;
  band: string | null;
  state: string;
  flagId: string | null;
  topApp: { id: string; name: string; match: number; inUse: boolean } | null;
};

const TOTALS: Record<string, [string, string][]> = {
  pl: [["revenue", "Revenue"], ["total_costs", "Total costs"], ["net_profit", "Net profit"]],
  bs: [["total_assets", "Total assets"], ["total_liabilities", "Total liabilities"], ["total_equity", "Total equity"]],
  cf: [["cfo", "Operating"], ["cfi", "Investing"], ["cff", "Financing"], ["net_change", "Net change in cash"]],
};

export default async function StatementPage({ params }: { params: Promise<{ org: string; kind: string }> }) {
  const { org, kind } = await params;
  if (!isKind(kind)) notFound();
  try {
    await requireOrgReader(org);
  } catch {
    return null;
  }
  const v = await statementView(org, kind);
  if (!v) {
    return (
      <>
        <h1>{KIND_LABEL[kind]}</h1>
        <p className="muted">No figures yet. Refresh from Xero on the Summary tab.</p>
      </>
    );
  }
  const totals = v.totals as Record<string, number>;

  return (
    <>
      <h1>{v.label}</h1>
      <p className="meta">
        {v.period.from ? <>{day(v.period.from)} to {day(v.period.to)}</> : <>As at {day(v.period.to)}</>}
        {v.base.value ? <> · shares are of {v.base.label.toLowerCase()} ({gbp(v.base.value)})</> : null}
      </p>
      {kind === "cf" ? (
        v.reconciled ? (
          <p className="note ok">Worked out from your balance sheet and profit. It ties back to the change in your bank balance.</p>
        ) : (
          <p className="note warn">{v.message}. We&apos;re checking it, and lines below aren&apos;t flagged until it ties back.</p>
        )
      ) : null}

      <dl className="totals">
        {TOTALS[kind]!.filter(([k]) => k in totals).map(([k, label]) => (
          <div key={k}>
            <dt>{label}</dt>
            <dd className="num">{gbp(totals[k]!)}</dd>
          </div>
        ))}
      </dl>

      {v.sections.map((sec) => (
        <section key={sec.key} className="stmt">
          <h2>{sec.label}</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col" className="r">Amount</th>
                <th scope="col" className="r hide-sm">Share</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {(sec.lines as Line[]).map((l) => {
                const linked = l.flagId && l.state !== "fine";
                return (
                  <tr key={l.key}>
                    <td>
                      {linked ? <Link href={lineHref(org, l.key)}>{l.name}</Link> : l.name}
                      {l.code ? <span className="muted small"> {l.code}</span> : null}
                    </td>
                    <td className="r num">{gbp(l.value)}</td>
                    <td className="r num muted hide-sm">{pct(l.share)}</td>
                    <td>
                      <span className={`badge b-${l.state}`}>{STATE_LABEL[l.state] ?? l.state}</span>
                      {l.state === "flagged" && l.topApp ? <span className="muted small block">Try {l.topApp.name}</span> : null}
                      {l.state === "covered" && l.topApp ? <span className="muted small block">{l.topApp.name}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
