"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

export type AppQuestion =
  | { kind: "still_use"; appId: string; name: string; lastSeen: string }
  | { kind: "replacing"; appId: string; name: string; old: string; oldName: string };

const month = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * v1.1 C: one question per app whose payments stopped, or a new app that may replace another. Until answered, a
 * lapsing app still counts as in use, so nothing is flagged on the strength of one missed payment.
 */
export function AppQuestions({ org, questions, apps }: { org: string; questions: AppQuestion[]; apps: { id: string; name: string }[] }) {
  if (!questions.length) return null;
  return (
    <section className="app-questions">
      <h2>Quick questions</h2>
      <ul className="plain">
        {questions.map((q) => (
          <li key={`${q.kind}:${q.appId}`} className="card">
            <Question org={org} q={q} apps={apps} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Question({ org, q, apps }: { org: string; q: AppQuestion; apps: { id: string; name: string }[] }) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function send(payload: Record<string, string>) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/orgs/${org}/apps/${q.appId}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    setBusy(false);
    if (!res?.ok) return setMsg({ text: json.error ?? "Couldn't save. Try again.", error: true });
    setMsg({ text: "Thanks, noted." });
    router.refresh();
  }

  if (q.kind === "replacing") {
    return (
      <>
        <span>We&apos;ve started seeing payments to <b>{q.name}</b>. Is it replacing <b>{q.oldName}</b>?</span>
        <span className="actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => send({ answer: "replacing", old_app_id: q.old })}>Yes, it&apos;s replacing it</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => send({ answer: "both" })}>No, we use both</button>
        </span>
        <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status">{msg?.text ?? ""}</span>
      </>
    );
  }
  return (
    <>
      <span>We haven&apos;t seen a payment to <b>{q.name}</b> since {month(q.lastSeen)}. Do you still use it?</span>
      <span className="actions">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => send({ answer: "still_use" })}>Yes, still use it</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setMoving((m) => !m)} aria-expanded={moving}>We moved to another app</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => send({ answer: "stopped" })}>We stopped using it</button>
      </span>
      {moving ? (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (to) void send({ answer: "moved", replaced_by_app_id: to }); }}>
          <label htmlFor={uid}>Which app?</label>
          <select id={uid} value={to} required onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {apps.filter((a) => a.id !== q.appId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="submit" className="btn" disabled={busy || !to}>Save</button>
        </form>
      ) : null}
      <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status">{msg?.text ?? ""}</span>
    </>
  );
}
