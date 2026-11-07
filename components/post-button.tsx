"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** A button that sends JSON to one of our routes, then refreshes the page. Shows the server's message on failure. */
export function PostButton({
  url,
  payload,
  method = "POST",
  label,
  done,
  className = "btn ghost",
}: {
  url: string;
  payload?: unknown;
  method?: "POST" | "PATCH" | "DELETE";
  label: string;
  done?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: payload === undefined ? undefined : { "content-type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setMsg({ text: json.error ?? `Couldn't save (HTTP ${res.status}).`, error: true });
      else {
        if (done) setMsg({ text: done });
        router.refresh();
      }
    } catch {
      setMsg({ text: "Couldn't reach FlowStack. Try again.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="post-button">
      <button type="button" className={className} disabled={busy} onClick={go}>
        {label}
      </button>
      <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">
        {msg?.text ?? ""}
      </span>
    </span>
  );
}
