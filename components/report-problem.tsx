"use client";

import { useState } from "react";

/** Where error screens leave the reference they showed, so a report can include it. */
export const LAST_REF_KEY = "fs:lastRef";

export function rememberRef(ref: string | undefined) {
  if (!ref) return;
  try {
    sessionStorage.setItem(LAST_REF_KEY, ref);
  } catch {
    // storage off (private mode): the report just goes without it
  }
}

/** "Report a problem" (NEXT-STEPS P0.5): page URL + last reference + a short note → our review queue. */
export function ReportProblem() {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    let requestId: string | undefined;
    try {
      requestId = sessionStorage.getItem(LAST_REF_KEY) ?? undefined;
    } catch {
      requestId = undefined;
    }
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: window.location.href, requestId, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ text: json.message ?? "Couldn't send. Try again.", error: true });
      setNote("");
      setMsg({ text: json.message ?? "Thanks. We've got it." });
    } catch {
      setMsg({ text: "Couldn't reach FlowStack. Try again.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="report">
      <summary>Report a problem</summary>
      <form onSubmit={send}>
        <label htmlFor="report-note" className="small">
          What happened? We&apos;ll attach this page&apos;s address and the last error reference. Please don&apos;t include figures.
        </label>
        <textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} required minLength={3} />
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
        <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">
          {msg?.text ?? ""}
        </span>
      </form>
    </details>
  );
}
