"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** "Is this right?" on a flagged line. "No" marks it not a problem for this org and sends it for review. */
export function FeedbackButtons({ flagId, state }: { flagId: string; state: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function send(answer: "yes" | "no") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/flags/${flagId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setMsg({ text: json.error ?? `Couldn't save (HTTP ${res.status}).`, error: true });
      else {
        setMsg({ text: answer === "no" ? "Marked as not a problem. We'll review it." : "Thanks. Kept as a problem." });
        router.refresh();
      }
    } catch {
      setMsg({ text: "Couldn't reach FlowStack. Try again.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="feedback">
      <span>Is this right?</span>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => send("yes")} aria-pressed={state === "flagged" || state === "covered"}>
        Yes, worth a look
      </button>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => send("no")} aria-pressed={state === "marked_fine"}>
        Not a problem
      </button>
      <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">
        {msg?.text ?? ""}
      </span>
    </div>
  );
}
