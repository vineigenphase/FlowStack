"use client";

import { useState } from "react";

type Plan = { key: string; label: string; price: string };

/** v1.1 E: subscribe through Stripe Checkout, or manage a subscription in the Customer Portal. */
export function BillingBox({ org, plans, subscribed, status }: { org: string; plans: Plan[]; subscribed: boolean; status: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async (url: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId: org, ...payload }) }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { url?: string; error?: string }) : {};
    setBusy(false);
    if (!res?.ok || !json.url) return setError(json.error ?? "Couldn't reach Stripe. Try again.");
    window.location.assign(json.url);
  };
  if (subscribed) {
    return (
      <p className="actions">
        <span>Subscription: <b>{status}</b></span>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => go("/api/billing/portal", {})}>Manage billing</button>
        <span className="refresh-msg error" role="status">{error}</span>
      </p>
    );
  }
  return (
    <div className="actions">
      {plans.map((p) => (
        <button key={p.key} type="button" className="btn" disabled={busy} onClick={() => go("/api/billing/checkout", { plan: p.key })}>
          {p.label} · {p.price}
        </button>
      ))}
      <span className="refresh-msg error" role="status">{error}</span>
    </div>
  );
}
