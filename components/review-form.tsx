"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Opt = { key: string; label: string };
type Initial = { role: string; scores: Record<string, number>; priceBand: string | null; body: string } | null;

/** Write or edit a review. Scores 1–5 as radio groups, so it works with a keyboard and a screen reader. */
export function ReviewForm({
  org,
  appId,
  appName,
  roles,
  priceBands,
  scoreLabels,
  initial,
}: {
  org: string;
  appId: string;
  appName: string;
  roles: Opt[];
  priceBands: Opt[];
  scoreLabels: Record<string, string>;
  initial: Initial;
}) {
  const router = useRouter();
  const [role, setRole] = useState(initial?.role ?? "");
  const [scores, setScores] = useState<Record<string, number>>(initial?.scores ?? {});
  const [price, setPrice] = useState(initial?.priceBand ?? "");
  const [text, setText] = useState(initial?.body ?? "");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (Object.keys(scoreLabels).some((k) => !scores[k])) return setMsg({ text: "Give each of the four scores.", error: true });
    setBusy(true);
    const res = await fetch(`/api/orgs/${org}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId, role, scores, priceBand: price || null, body: text }),
    }).catch(() => null);
    setBusy(false);
    const json = res ? ((await res.json().catch(() => ({}))) as { error?: string; details?: { message?: string }[] }) : {};
    if (!res || !res.ok) setMsg({ text: json.details?.[0]?.message ?? json.error ?? "Couldn't save.", error: true });
    else {
      setMsg({ text: "Thanks. A person checks every review before it appears, usually within two working days." });
      router.refresh();
    }
  }

  return (
    <form className="stack-form review-form" onSubmit={save} aria-label={`Review of ${appName}`}>
      <label>
        <span>Your role</span>
        <select required value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Choose…</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
      </label>
      {Object.entries(scoreLabels).map(([k, label]) => (
        <fieldset key={k} className="scores">
          <legend>{label}</legend>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="check-label">
              <input type="radio" name={`${appId}-${k}`} value={n} checked={scores[k] === n} onChange={() => setScores({ ...scores, [k]: n })} />
              {n}
            </label>
          ))}
          <span className="muted small">1 poor · 5 excellent</span>
        </fieldset>
      ))}
      <label>
        <span>What you pay (optional)</span>
        <select value={price} onChange={(e) => setPrice(e.target.value)}>
          <option value="">Rather not say</option>
          {priceBands.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Your review</span>
        <textarea required minLength={30} maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What it does well, what it doesn't, and what going live was like." />
      </label>
      <div className="inline-form">
        <button type="submit" className="btn" disabled={busy}>{initial ? "Update review" : "Send review"}</button>
        <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">{msg?.text ?? ""}</span>
      </div>
    </form>
  );
}

/** The 90-day re-rate of support after go-live. */
export function FollowupForm({ org, reviewId }: { org: string; reviewId: string }) {
  const router = useRouter();
  const [score, setScore] = useState(0);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!score) return setMsg({ text: "Pick a score.", error: true });
    const res = await fetch(`/api/orgs/${org}/reviews/${reviewId}/followup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ supportScore: score, note: note || undefined }),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    if (!res || !res.ok) setMsg({ text: json.error ?? "Couldn't save.", error: true });
    else router.refresh();
  }

  return (
    <form className="stack-form" onSubmit={save}>
      <fieldset className="scores">
        <legend>90 days on: support after go-live</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="check-label">
            <input type="radio" name={`fu-${reviewId}`} value={n} checked={score === n} onChange={() => setScore(n)} />
            {n}
          </label>
        ))}
      </fieldset>
      <label>
        <span>Anything to add (optional)</span>
        <textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="inline-form">
        <button type="submit" className="btn">Save</button>
        <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">{msg?.text ?? ""}</span>
      </div>
    </form>
  );
}
