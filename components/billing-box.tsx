"use client";

import { useState } from "react";
import type { Plan } from "@/lib/api/types";

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const per: Record<Plan["interval"], string> = { month: "a month", year: "a year", one_off: "one-off" };

/**
 * v1.1 E + round-2 3e: plan cards → Stripe Checkout, or "Manage billing" → the Customer Portal.
 * Prices only from the API (catalog/plans.yaml). A plan without a price can't be chosen.
 */
export function BillingBox({ org, plans, subscribed, status, renews }: { org: string; plans: Plan[]; subscribed: boolean; status: string | null; renews: string | null }) {
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
        <span>
          Subscription: <b>{status}</b>
          {renews ? <> · renews <span className="num">{renews}</span></> : null}
        </span>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => go("/api/billing/portal", {})}>
          Manage billing
        </button>
        <span className="refresh-msg error" role="status">{error}</span>
      </p>
    );
  }
  return (
    <>
      <ul className="cards">
        {plans.map((p) => (
          <li key={p.id} className="card">
            <span className="card-head">
              <b>{p.label}</b>
              {p.highlight ? <span className="tag">best value</span> : null}
            </span>
            <span>{p.priceGbp === null ? "Price coming soon" : <><span className="num">{gbp(p.priceGbp)}</span> {per[p.interval]}</>}</span>
            <span className="muted small">
              {p.id === "audit_only"
                ? "A one-off audit of your stack, no subscription."
                : p.auditIncluded
                  ? "Up-front audit of your stack included."
                  : p.auditPriceGbp !== null
                    ? <>Plus a one-off audit of your stack (<span className="num">{gbp(p.auditPriceGbp)}</span>).</>
                    : "Plus a one-off audit of your stack."}
            </span>
            <span className="card-actions">
              <button type="button" className="btn" disabled={busy || p.priceGbp === null} onClick={() => go("/api/billing/checkout", { planId: p.id })}>
                Choose
              </button>
            </span>
          </li>
        ))}
      </ul>
      <span className="refresh-msg error" role="status">{error}</span>
    </>
  );
}
