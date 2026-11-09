"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

/** Business switcher (v1.1 I) for accountants, bookkeepers and groups. Shown only with more than one business. */
export function OrgSwitcher({ current, orgs }: { current: string; orgs: { id: string; name: string; sample: boolean }[] }) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  if (orgs.length < 2) return null;
  return (
    <span className="org-switcher">
      <label htmlFor={id} className="sr-only">Switch business</label>
      <select
        id={id}
        value={current}
        disabled={busy}
        onChange={async (e) => {
          const orgId = e.target.value;
          setBusy(true);
          await fetch("/api/me/active-org", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId }) }).catch(() => null);
          router.push(`/app/${orgId}`);
          setBusy(false);
        }}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.sample ? " (sample)" : ""}
          </option>
        ))}
      </select>
    </span>
  );
}
