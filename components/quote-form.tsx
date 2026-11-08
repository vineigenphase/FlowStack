"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Situation = { industry: string | null; sizeBand: string | null; markets: string[]; keeps: string[] };

/** Ask up to three vendors for a quote. Shows exactly what will be sent before sending. */
export function QuoteForm({ org, lineKey, apps, situation }: { org: string; lineKey: string; apps: { id: string; name: string }[]; situation: Situation }) {
  const router = useRouter();
  const [pick, setPick] = useState<string[]>(apps.slice(0, 3).map((a) => a.id));
  const [sites, setSites] = useState("");
  const [headcount, setHeadcount] = useState("");
  const [must, setMust] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch(`/api/orgs/${org}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appIds: pick,
        lineKey,
        sites: sites ? Number(sites) : null,
        headcount: headcount ? Number(headcount) : null,
        mustHaves: must || null,
        replyTo: email,
      }),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { error?: string; details?: { message?: string }[] }) : {};
    if (!res || !res.ok) setMsg({ text: json.details?.[0]?.message ?? json.error ?? "Couldn't send.", error: true });
    else {
      setMsg({ text: "Sent to our team. We pass it to the vendors and add their replies here as they come in." });
      router.refresh();
    }
  }

  return (
    <form className="stack-form" onSubmit={send}>
      <fieldset>
        <legend>Vendors to ask (up to 3)</legend>
        {apps.map((a) => (
          <label key={a.id} className="check-label">
            <input
              type="checkbox"
              checked={pick.includes(a.id)}
              disabled={!pick.includes(a.id) && pick.length >= 3}
              onChange={(e) => setPick(e.target.checked ? [...pick, a.id] : pick.filter((x) => x !== a.id))}
            />
            {a.name}
          </label>
        ))}
      </fieldset>
      <div className="two-col">
        <label>
          <span>Sites (optional)</span>
          <input type="number" min={1} value={sites} onChange={(e) => setSites(e.target.value)} />
        </label>
        <label>
          <span>People (optional)</span>
          <input type="number" min={1} value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
        </label>
      </div>
      <label>
        <span>Must-haves (optional)</span>
        <input value={must} maxLength={500} onChange={(e) => setMust(e.target.value)} placeholder="e.g. tronc, 4-weekly pay" />
      </label>
      <label>
        <span>Where vendors should reply</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbusiness.co.uk" />
      </label>
      <div className="note small">
        <b>What vendors will see:</b> {situation.industry ?? "industry not set"}, {situation.sizeBand ?? "size not known"}, trading in{" "}
        {situation.markets.join(", ")}
        {sites ? `, ${sites} sites` : ""}
        {headcount ? `, ${headcount} people` : ""}; keeping {situation.keeps.join(", ") || "no other apps"}
        {must ? `; must have: ${must}` : ""}; reply to {email || "your email"}. Never your figures or transactions.
      </div>
      <div className="inline-form">
        <button type="submit" className="btn ghost" disabled={!pick.length}>Ask for quotes</button>
        <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">{msg?.text ?? ""}</span>
      </div>
    </form>
  );
}
