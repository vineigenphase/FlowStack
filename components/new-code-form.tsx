"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Make an invite code (NEXT-STEPS P0.5). The code shows here and in the table below. */
export function NewCodeForm() {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [uses, setUses] = useState(1);
  const [days, setDays] = useState(30);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function make(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/testers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "code", note: note || undefined, maxUses: uses, expiresDays: days }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ text: json.message ?? "Couldn't make a code.", error: true });
    setMsg({ text: `New code: ${json.code}` });
    setNote("");
    router.refresh();
  }

  return (
    <form onSubmit={make} className="panel">
      <label>
        Who is it for <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. council member, Acme Ltd" />
      </label>{" "}
      <label>
        Uses <input type="number" min={1} max={5} value={uses} onChange={(e) => setUses(Number(e.target.value))} />
      </label>{" "}
      <label>
        Expires in (days) <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </label>{" "}
      <button type="submit" className="btn">
        Make a code
      </button>
      <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">
        {msg?.text ?? ""}
      </span>
    </form>
  );
}
