"use client";

import Link from "next/link";
import { useId, useState } from "react";

type One = {
  mode: "rules" | "written";
  why: string | null;
  jobs: { key: string; label: string }[];
  candidates: { id: string; name: string; reasons: string[]; price: string | null; support: string | null }[];
  answer: string | null;
  points: { text: string; cites: string[] }[];
};
type Across = { jobs: { key: string; label: string }[]; clients: { orgId: string; name: string; top: { id: string; name: string; reasons: string[] }[]; needsLook: boolean }[] };

function citeLabel(c: string, names: Map<string, string>) {
  const [kind, id] = c.split(":");
  if (kind === "app" || kind === "stack") return names.get(id!) ?? id;
  if (kind === "signal") return "your figures";
  return c;
}

export function AskBox({ url, across = false, placeholder }: { url: string; across?: boolean; placeholder: string }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [one, setOne] = useState<One | null>(null);
  const [many, setMany] = useState<Across | null>(null);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) return setErr((json as { error?: string } | null)?.error ?? "Couldn't ask right now.");
    if (across) setMany(json as Across);
    else setOne(json as One);
  }

  const names = new Map((one?.candidates ?? []).map((c) => [c.id, c.name]));
  return (
    <div className="ask">
      <form className="ask-form" onSubmit={go}>
        <label htmlFor={id} className="sr-only">Your question</label>
        <input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} minLength={3} maxLength={500} required />
        <button type="submit" className="btn" disabled={busy}>{busy ? "Looking…" : "Ask"}</button>
      </form>
      <p className="refresh-msg error" role="status" aria-live="polite">{err ?? ""}</p>

      {one ? (
        <section aria-live="polite">
          {one.jobs.length ? <p className="muted small">Looking at: {one.jobs.map((j) => j.label).join(", ")}</p> : null}
          {one.answer ? (
            <div className="note">
              <p>{one.answer}</p>
              {one.points.length ? (
                <ul>
                  {one.points.map((p, i) => (
                    <li key={i}>
                      {p.text} <span className="muted small">[{p.cites.map((c) => citeLabel(c, names)).join(", ")}]</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="muted small">Written from a summary of your business with no amounts. Check the app pages before deciding.</p>
            </div>
          ) : one.why ? (
            <p className="muted small">{one.why}</p>
          ) : null}
          {one.candidates.length ? (
            <ol className="cards">
              {one.candidates.map((c) => (
                <li key={c.id} className="card">
                  <span className="card-head">
                    <b><Link href={`/apps/${c.id}`}>{c.name}</Link></b>
                    <span className="small">{c.price ?? <span className="muted">Price not published</span>}</span>
                  </span>
                  <span className="small">{c.reasons.join(". ") || "Matches your question"}</span>
                  {c.support ? <span className="muted small">{c.support}</span> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No apps in our catalogue match that. Try naming the job, e.g. &quot;payroll&quot; or &quot;stock&quot;.</p>
          )}
        </section>
      ) : null}

      {many ? (
        <section aria-live="polite">
          {many.jobs.length ? <p className="muted small">Looking at: {many.jobs.map((j) => j.label).join(", ")}</p> : null}
          <ul className="plain">
            {many.clients.map((c) => (
              <li key={c.orgId} className="card">
                <span className="card-head">
                  <b><Link href={`/app/${c.orgId}`}>{c.name}</Link></b>
                  {c.needsLook ? <span className="badge b-flagged">Needs a look</span> : null}
                </span>
                <span className="small">{c.top.length ? c.top.map((t) => t.name).join(", ") : <span className="muted">No match</span>}</span>
                {c.top[0]?.reasons.length ? <span className="muted small">{c.top[0].name}: {c.top[0].reasons.join(". ")}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
