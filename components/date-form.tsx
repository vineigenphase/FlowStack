"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

/** One date field that saves itself to a route (e.g. a renewal date), then refreshes the page. */
export function DateForm({ url, field, label, value, method = "PATCH" }: { url: string; field: string; label: string; value: string | null; method?: "PATCH" | "POST" }) {
  const router = useRouter();
  const id = useId();
  const [v, setV] = useState(value ?? "");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ [field]: v || null }) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    if (!res || !res.ok) setMsg({ text: json.error ?? "Couldn't save.", error: true });
    else {
      setMsg({ text: "Saved" });
      router.refresh();
    }
  }

  return (
    <form className="inline-form" onSubmit={save}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="date" value={v} onChange={(e) => setV(e.target.value)} />
      <button type="submit" className="btn ghost">Save</button>
      <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">{msg?.text ?? ""}</span>
    </form>
  );
}
