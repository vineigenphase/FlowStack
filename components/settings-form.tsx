"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  org: string;
  industries: { key: string; label: string }[];
  initial: { industry: string | null; markets: string[]; sharePrices: boolean; askAi: boolean; sample: boolean };
  /** v1.1 G: peer prices are out of 1.0, so the opt-in is hidden unless enabled. */
  peerPrices?: boolean;
};

const MARKETS = ["UK", "US", "CA", "AU"];

export function SettingsForm({ org, industries, initial, peerPrices = false }: Props) {
  const router = useRouter();
  const [industry, setIndustry] = useState(initial.industry ?? "");
  const [markets, setMarkets] = useState<string[]>(initial.markets);
  const [share, setShare] = useState(initial.sharePrices);
  const [ask, setAsk] = useState(initial.askAi);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch(`/api/orgs/${org}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ industry: industry || null, markets, sharePrices: share, askAi: ask }),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    if (!res || !res.ok) setMsg({ text: json.error ?? "Couldn't save.", error: true });
    else {
      setMsg({ text: "Saved" });
      router.refresh();
    }
  }

  return (
    <form className="stack-form" onSubmit={save}>
      <label>
        <span>Industry</span>
        <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
          <option value="">Not set</option>
          {industries.map((i) => (
            <option key={i.key} value={i.key}>{i.label}</option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Markets you trade in</legend>
        {MARKETS.map((m) => (
          <label key={m} className="check-label">
            <input
              type="checkbox"
              checked={markets.includes(m)}
              onChange={(e) => setMarkets(e.target.checked ? [...markets, m] : markets.filter((x) => x !== m))}
            />
            {m}
          </label>
        ))}
      </fieldset>

      {peerPrices ? (
      <fieldset>
        <legend>Help other businesses compare prices</legend>
        <label className="check-label">
          <input type="checkbox" checked={share} disabled={initial.sample} onChange={(e) => setShare(e.target.checked)} />
          Count what we pay each app in anonymous price ranges
        </label>
        <p className="muted small">
          We take the monthly total of your bills from each app we recognise and add it to a range (lowest quarter, middle, highest
          quarter). A range only appears once 10 or more businesses are in it, and never names anyone. It&apos;s plain arithmetic: nothing
          is used to train AI. Turn it off at any time and your figures are removed straight away.
          {initial.sample ? " Sample organisations never count." : ""}
        </p>
      </fieldset>
      ) : null}

      <fieldset>
        <legend>Written answers in Ask</legend>
        <label className="check-label">
          <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} />
          Let Ask send a summary of our business to our AI provider (Anthropic) to write answers
        </label>
        <p className="muted small">
          The summary is your industry, size band, markets, the names of apps we found in your bills and which finance jobs need a look.
          Never amounts, transactions, or customer or supplier names. It&apos;s used only to answer your question, isn&apos;t kept by the
          provider for training, and nothing trains AI on your data. Without this, Ask still works: it lists matching apps from your
          figures without a written answer.
        </p>
      </fieldset>

      <div className="inline-form">
        <button type="submit" className="btn">Save</button>
        <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">{msg?.text ?? ""}</span>
      </div>
    </form>
  );
}
