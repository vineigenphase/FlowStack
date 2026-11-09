"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Asked once after sign-up (v1.1 A): who actually connects. Changes no permissions. */
export function JobTitleForm({ options }: { options: { key: string; label: string }[] }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const save = async (jobTitle: string) => {
    const res = await fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobTitle }) }).catch(() => null);
    if (!res?.ok) return setError("Couldn't save. Try again.");
    router.refresh();
  };
  return (
    <form
      className="card job-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) void save(value);
      }}
    >
      <fieldset className="choices">
        <legend>One question: what&apos;s your role?</legend>
        {options
          .filter((o) => o.key !== "not_given")
          .map((o) => (
            <label key={o.key} className="chip">
              <input type="radio" name="job" value={o.key} checked={value === o.key} onChange={() => setValue(o.key)} /> {o.label}
            </label>
          ))}
      </fieldset>
      <p className="muted small">It helps us see who sets FlowStack up. It doesn&apos;t change what you can see or do.</p>
      <p className="actions">
        <button type="submit" className="btn" disabled={!value}>Save</button>
        <button type="button" className="btn ghost" onClick={() => void save("not_given")}>Skip</button>
        <span className="refresh-msg error" role="status">{error}</span>
      </p>
    </form>
  );
}
