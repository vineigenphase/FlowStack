import Link from "next/link";
import { requireOrgReader } from "@/lib/auth/session";
import { afterInstallView } from "@/lib/checkins";
import { DateForm } from "@/components/date-form";
import { PostButton } from "@/components/post-button";
import { day, gbp, lineHref } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

const CHECK_LABEL: Record<string, string> = { d7: "Day 7", d30: "Day 30", d90: "Day 90", renewal: "Before renewal" };
const CHECK_ASKS: Record<string, string> = {
  d7: "Are its bills reaching Xero?",
  d30: "Does the line now count as handled?",
  d90: "Is the line still flagged, and how far has it moved?",
  renewal: "Is the price in the usual range? (60 days before renewal)",
};
const STATUS_LABEL: Record<string, string> = { pending: "Not due yet", ok: "Working", not_yet: "Not yet", failed: "Needs a look", info: "For information" };

/** Last 12 months of bills from the app, with the install month marked. Bars only: no target we can't measure. */
function Bills({ monthly, installedOn }: { monthly: Record<string, number>; installedOn: string }) {
  const months: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push(m.toISOString().slice(0, 10));
  }
  const max = Math.max(1, ...months.map((m) => monthly[m] ?? 0));
  const start = `${installedOn.slice(0, 7)}-01`;
  const label = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return (
    <figure className="bills">
      <div className="bills-bars" role="img" aria-label="Bills from this app per month for the last 12 months">
        {months.map((m) => {
          const v = monthly[m] ?? 0;
          return (
            <div key={m} className={m === start ? "bar-col start" : "bar-col"} title={`${label(m)}: ${gbp(v)}`}>
              <span className="bar" style={{ height: `${Math.round((v / max) * 100)}%` }} />
              <span className="bar-label">{label(m).slice(0, 1)}</span>
            </div>
          );
        })}
      </div>
      <figcaption className="muted small">Bills from it reaching Xero, per month. The marked month is when you started.</figcaption>
    </figure>
  );
}

export default async function AfterPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireOrgReader(org);
  } catch {
    return null;
  }
  const rows = await afterInstallView(org);

  return (
    <>
      <h1>After install</h1>
      <p className="meta">
        Apps you&apos;ve started using, checked against your own figures at day 7, 30 and 90, and before renewal. We can see bills and how each
        line looks after a refresh, not inside the app itself, so each check says exactly what it looked at.
      </p>

      {rows.length ? null : (
        <p className="note">
          Nothing here yet. Open a line that&apos;s worth a look and press &quot;We&apos;ve started using it&quot; on the app you chose. If we see
          bills from an app we suggested, it turns up here on its own.
        </p>
      )}

      {rows.map((r) => (
        <section key={r.id} className="install">
          <h2>
            {r.name}
            {r.source === "detected" ? <span className="tag">seen in your bills</span> : null}
          </h2>
          <p className="meta">
            Started {day(r.installedOn)}
            {r.lineKey ? (
              <>
                {" "}· for <Link href={lineHref(org, r.lineKey)}>{r.line?.name ?? r.baseline.lineName ?? r.lineKey}</Link>
                {r.baseline.lineValue !== null ? <> (was {gbp(r.baseline.lineValue)})</> : null}
              </>
            ) : null}
          </p>
          <Bills monthly={r.monthly} installedOn={r.installedOn} />
          <ol className="checks">
            {r.checkins.map((c) => (
              <li key={c.kind} className={`check s-${c.status}`}>
                <span className="check-head">
                  <b>{CHECK_LABEL[c.kind]}</b>
                  <span className={`badge c-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                </span>
                <span className="small">{c.result?.headline ?? CHECK_ASKS[c.kind]}</span>
                {c.result?.detail ? <span className="muted small block">{c.result.detail}</span> : null}
                <span className="muted small block">{c.status === "pending" ? `Due ${day(c.dueOn)}` : c.checkedAt ? `Checked ${day(new Date(c.checkedAt).toISOString().slice(0, 10))}` : null}</span>
              </li>
            ))}
          </ol>
          <div className="install-actions">
            <DateForm url={`/api/orgs/${org}/installs/${r.id}`} field="renewalOn" label="Renewal date" value={r.renewalOn} />
            <PostButton url={`/api/orgs/${org}/installs/${r.id}`} method="DELETE" label="We stopped using it" />
          </div>
        </section>
      ))}
    </>
  );
}
