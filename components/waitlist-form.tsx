"use client";

import { useState } from "react";

const ROLES = [
  ["fd", "FD"],
  ["financial_controller", "Financial controller"],
  ["finance_manager", "Finance manager"],
  ["head_of_finance", "Head of finance"],
  ["accountant_bookkeeper", "Accountant or bookkeeper"],
  ["other", "Other"],
] as const;
const INDUSTRIES = [
  ["ecommerce", "Ecommerce"],
  ["saas", "SaaS"],
  ["other", "Other"],
] as const;

/** Waitlist (UI-SPEC §5.1) → POST /api/waitlist. A repeat email gets the same success message. */
export function WaitlistForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(form: HTMLFormElement) {
    const f = new FormData(form);
    setState("sending");
    setError("");
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: f.get("email"),
        name: f.get("name"),
        company: f.get("company"),
        role: f.get("role"),
        industry: f.get("industry"),
        consent: f.get("consent") === "on",
      }),
    }).catch(() => null);
    if (res?.ok) return setState("done");
    setState("error");
    setError(res?.status === 400 ? "Check the fields above: every one is needed, and the email must be valid." : "Couldn't send. Try again.");
  }

  if (state === "done") return <p role="status">You&apos;re on the list. We&apos;ll email you once.</p>;
  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      <label>
        Work email
        <input name="email" type="email" autoComplete="email" required maxLength={200} />
      </label>
      <label>
        Name
        <input name="name" autoComplete="name" required maxLength={120} />
      </label>
      <label>
        Company
        <input name="company" autoComplete="organization" required maxLength={160} />
      </label>
      <label>
        Your role
        <select name="role" required defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          {ROLES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Industry
        <select name="industry" required defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          {INDUSTRIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="check-label">
        <input name="consent" type="checkbox" required /> FlowStack can email me about joining.
      </label>
      <p className="actions">
        <button type="submit" className="btn" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Join the waitlist"}
        </button>
        <span className="refresh-msg error" role="status">
          {error}
        </span>
      </p>
    </form>
  );
}
