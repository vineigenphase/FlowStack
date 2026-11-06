import Link from "next/link";
import type { CSSProperties } from "react";
import { requireOrgMember } from "@/lib/auth/session";
import { stackMapView } from "@/lib/read/views";
import type { FunctionStatus, Link as XeroLink, MapFunction } from "@/lib/map/build";
import { gbp, lineHref } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

const STATUS: Record<FunctionStatus, string> = {
  gap: "Gap: no app",
  part_manual: "Part by hand",
  connected: "Connected",
  checking: "Being checked",
  quiet: "Nothing on your figures",
};
const LINK: Record<XeroLink, string> = {
  native: "Posts to Xero directly",
  via_app: "Reaches Xero through",
  csv: "Reaches Xero by CSV import (by hand)",
  unknown: "Link to Xero not in our catalogue yet",
};

function FnCard({ org, f, side, row }: { org: string; f: MapFunction; side: "l" | "r"; row: number }) {
  const flagged = f.lines.filter((l) => l.state === "flagged");
  return (
    <section className={`fn fn-${f.status} side-${side}`} style={{ "--row": row } as CSSProperties} aria-label={f.label}>
      <header className="fn-head">
        <h3>{f.label}</h3>
        <span className={`badge s-${f.status}`}>{STATUS[f.status]}</span>
      </header>
      {f.apps.length ? (
        <ul className="fn-apps">
          {f.apps.map((a) => (
            <li key={a.id}>
              <b>{a.name}</b>
              <span className={`link-note l-${a.link}`}>
                {LINK[a.link]}
                {a.via ? ` ${a.via}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fn-none">No app in use</p>
      )}
      {flagged.length ? (
        <p className="small">
          {f.atStake ? <><span className="num">{gbp(f.atStake)}</span> of costs at stake · </> : null}
          {flagged.length} line{flagged.length === 1 ? "" : "s"} worth a look:{" "}
          {flagged.slice(0, 3).map((l, i) => (
            <span key={l.key}>
              {i ? ", " : ""}
              <Link href={lineHref(org, l.key)}>{l.code ? `${l.code} ${l.name}` : l.name}</Link>
            </span>
          ))}
          {flagged.length > 3 ? ` and ${flagged.length - 3} more` : ""}
        </p>
      ) : null}
      {f.status === "checking" ? <p className="small muted">We&apos;re checking which accounts belong here.</p> : null}
      {f.suggestion && f.status === "gap" ? (
        <p className="small">
          Best match: <b>{f.suggestion.name}</b> ({f.suggestion.match}%){f.suggestion.worksWith.length ? `, works with ${f.suggestion.worksWith.join(" and ")}` : ""}
        </p>
      ) : null}
    </section>
  );
}

export default async function MapPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireOrgMember(org);
  } catch {
    return null;
  }
  const m = await stackMapView(org);
  if (!m) {
    return (
      <>
        <h1>Stack map</h1>
        <p className="muted">No figures yet. Refresh from Xero on the Summary tab.</p>
      </>
    );
  }

  const active = m.functions.filter((f) => f.status !== "quiet");
  // Gaps and part-manual first so they sit nearest the top, then split between the two sides of Xero.
  const order: FunctionStatus[] = ["gap", "part_manual", "checking", "connected"];
  active.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.atStake - a.atStake);
  const quiet = m.functions.filter((f) => f.status === "quiet");
  const rows = Math.max(1, Math.ceil(active.length / 2));

  return (
    <>
      <h1>Stack map</h1>
      <p className="meta">Xero in the middle, each finance job around it, from your latest figures and the apps we found in your bills.</p>

      <ul className="legend" aria-label="Key">
        <li><span className="key k-connected" /> Connected</li>
        <li><span className="key k-part_manual" /> Part by hand</li>
        <li><span className="key k-gap" /> Gap: worth a look</li>
        <li><span className="key k-checking" /> Being checked</li>
      </ul>

      <div className="hub" style={{ "--rows": rows } as CSSProperties}>
        <div className="hub-core">
          <span className="core-name">Xero</span>
          <span className="small">Your ledger</span>
          <span className="small muted">Read-only: we never change it</span>
        </div>
        {active.map((f, i) => (
          <FnCard key={f.key} org={org} f={f} side={i % 2 ? "r" : "l"} row={Math.floor(i / 2) + 1} />
        ))}
      </div>

      {quiet.length ? (
        <p className="small muted">
          Not showing up in your figures: {quiet.map((f) => f.label).join(", ")}.
        </p>
      ) : null}

      <h2>Fixes, in order</h2>
      {m.fixes.length ? (
        <ol className="fixes">
          {m.fixes.map((x) => (
            <li key={x.fn}>
              <span className="fix-n num">{x.n}</span>
              <div>
                <b>{x.title}</b>
                {x.atStake ? <span className="num small"> · {gbp(x.atStake)}</span> : null}
                <span className="block small">{x.why}</span>
                {x.lineKeys.length ? (
                  <span className="block small">
                    Evidence:{" "}
                    {x.lineKeys.slice(0, 4).map((k, i) => (
                      <span key={k}>
                        {i ? ", " : ""}
                        <Link href={lineHref(org, k)}>{m.functions.find((f) => f.key === x.fn)?.lines.find((l) => l.key === k)?.name ?? k}</Link>
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nothing to fix on your latest figures.</p>
      )}
      <p className="muted small">
        Apps you already pay for come first: getting them working properly usually beats adding another. Links to Xero come from our
        catalogue, which a person hasn&apos;t checked yet.
      </p>
    </>
  );
}
