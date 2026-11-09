"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

type Answer = "yes" | "already_use_app" | "no_app_needed" | "numbers_wrong" | "not_now";

const DONE: Record<Answer, string> = {
  yes: "Thanks. Kept as worth a look.",
  already_use_app: "Thanks. We've noted the app you use, and our team will teach FlowStack to spot it.",
  no_app_needed: "Marked as fine for you. Our team will review the rule.",
  numbers_wrong: "Thanks. This line shows as Checking while our team looks at it.",
  not_now: "Hidden for 90 days. It comes back after that.",
};

/**
 * "Is this right?" on a flagged line (v1.1 D): yes, or one of four specific reasons it isn't, so a detection miss,
 * a rule that doesn't fit and a wrong figure are told apart.
 */
export function FeedbackButtons({ flagId, state, apps }: { flagId: string; state: string; apps: { id: string; name: string }[] }) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [appId, setAppId] = useState("");
  const [appName, setAppName] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function send(answer: Answer, extra: Record<string, string> = {}) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/flags/${flagId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer, ...extra }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setMsg({ text: json.error ?? `Couldn't save (HTTP ${res.status}).`, error: true });
      else {
        setMsg({ text: DONE[answer] });
        setPicking(false);
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
      <div className="feedback-answers">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => send("yes")} aria-pressed={state === "flagged"}>
          Yes, worth a look
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setPicking((p) => !p)} aria-expanded={picking} aria-pressed={state === "covered"}>
          We already use an app for this
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => send("no_app_needed")} aria-pressed={state === "marked_fine"}>
          We don&apos;t need an app for this
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => send("numbers_wrong")} aria-pressed={state === "queued"}>
          This figure isn&apos;t right
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => send("not_now")} aria-pressed={state === "snoozed"}>
          Right, but not now
        </button>
      </div>
      {picking ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send("already_use_app", appId ? { app_id: appId } : { app_name: appName });
          }}
        >
          <label htmlFor={`${uid}-app`}>Which app?</label>
          <select id={`${uid}-app`} value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">Not listed: I&apos;ll type it</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {appId ? null : (
            <>
              <label htmlFor={`${uid}-name`} className="sr-only">App name</label>
              <input id={`${uid}-name`} placeholder="App name" required maxLength={120} value={appName} onChange={(e) => setAppName(e.target.value)} />
            </>
          )}
          <button type="submit" className="btn" disabled={busy}>Save</button>
        </form>
      ) : null}
      <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">
        {msg?.text ?? ""}
      </span>
    </div>
  );
}
