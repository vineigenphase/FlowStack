"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ApiError, RefreshRun } from "@/lib/api/types";
import { rememberRef } from "./report-problem";

const WORDS = { pending: "Waiting", running: "Working…", done: "Done", error: "Failed" } as const;

/**
 * Polls GET /api/orgs/:org/refresh/:runId every 2 s until the run stops (UI-SPEC §5.3). "Still working" after 60 s.
 * Done → the overview; partial → the overview with a note; error → message, Try again and the request id.
 */
export function RunProgress({ org, initial }: { org: string; initial: RefreshRun }) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [err, setErr] = useState<ApiError | null>(null);
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const started = useRef<number | null>(null);

  useEffect(() => {
    if (run.status !== "running") return;
    started.current ??= Date.now();
    const t = setInterval(async () => {
      if (Date.now() - (started.current ?? Date.now()) > 60_000) setSlow(true);
      try {
        const res = await fetch(`/api/orgs/${org}/refresh/${run.id}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) return setErr(json as ApiError);
        setErr(null);
        setRun(json as RefreshRun);
      } catch {
        // Keep polling: a dropped request isn't a failed refresh.
      }
    }, 2000);
    return () => clearInterval(t);
  }, [org, run.id, run.status]);

  useEffect(() => {
    if (run.status === "ok") router.push(`/app/${org}`);
  }, [run.status, org, router]);

  useEffect(() => rememberRef(err?.requestId ?? run.error?.requestId), [err, run.error]);

  async function retry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/orgs/${org}/refresh`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) return setErr(json as ApiError);
      started.current = Date.now();
      setSlow(false);
      setErr(null);
      setRun(json as RefreshRun);
      router.replace(`/connect/progress?run=${(json as RefreshRun).id}`);
    } finally {
      setRetrying(false);
    }
  }

  const failed = run.steps.filter((s) => s.status === "error").map((s) => s.label);
  return (
    <section className="panel" aria-live="polite">
      <ol className="steps">
        {run.steps.map((s) => (
          <li key={s.key} className={`step step-${s.status}`}>
            <span>{s.label}</span> <span className="muted small">{WORDS[s.status]}</span>
          </li>
        ))}
      </ol>
      {run.status === "running" && slow ? <p className="muted">Still working, large ledgers take longer.</p> : null}
      {run.status === "ok" ? <p>Done. Opening your overview…</p> : null}
      {run.status === "partial" ? (
        <p className="banner">
          Some data couldn&apos;t load: {failed.join(", ") || "one step"}. We&apos;ll retry tonight. <Link href={`/app/${org}`}>Open your overview</Link>
        </p>
      ) : null}
      {run.status === "error" ? (
        <div role="alert">
          <p>{run.error?.message ?? "The update from Xero didn't finish."}</p>
          <button type="button" className="btn" onClick={retry} disabled={retrying}>
            {retrying ? "Starting…" : "Try again"}
          </button>
          {run.error?.requestId ? <p className="request-id">Reference: {run.error.requestId}</p> : null}
        </div>
      ) : null}
      {err ? (
        <p role="alert">
          {err.message} <span className="request-id">Reference: {err.requestId}</span>
        </p>
      ) : null}
    </section>
  );
}
