"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type State = { kind: "idle" } | { kind: "running"; since: number } | { kind: "done"; status: string } | { kind: "error"; message: string };

/**
 * POSTs /api/orgs/:org/refresh, which starts the run and returns at once (NEXT-STEPS P0.3), then polls
 * /refresh/:runId every 2 s until it stops and re-renders the page's server data.
 * `busy` = a refresh is already running server-side (e.g. the first one after connect).
 */
export function RefreshButton({ org, busy = false }: { org: string; busy?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.kind !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.kind]);

  // While a refresh runs server-side (e.g. the first one after connecting), the button is disabled. Re-read the
  // page every few seconds so it comes back on its own, instead of needing a tab switch or reload.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [busy, router]);

  async function refresh() {
    const since = Date.now();
    setNow(since);
    setState({ kind: "running", since });
    try {
      const res = await fetch(`/api/orgs/${org}/refresh`, { method: "POST" });
      let json = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: string; message?: string; requestId?: string };
      if (!res.ok) {
        setState({ kind: "error", message: `${json.message ?? json.error ?? `Refresh failed (HTTP ${res.status}).`}${json.requestId ? ` (ref ${json.requestId})` : ""}` });
        return;
      }
      // The steps run in the background: wait for the run to stop (5 minutes at most, the function limit).
      while (json.status === "running" && json.id && Date.now() - since < 300_000) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(`/api/orgs/${org}/refresh/${json.id}`, { cache: "no-store" });
        if (poll.ok) json = await poll.json();
      }
      if (json.status === "error") {
        setState({ kind: "error", message: (json as { error?: { message?: string } }).error?.message ?? "The update from Xero didn't finish." });
        router.refresh();
        return;
      }
      setState({ kind: "done", status: json.status ?? "ok" });
      router.refresh();
    } catch {
      setState({ kind: "error", message: "Couldn't reach FlowStack. Check your connection and try again." });
    }
  }

  const running = state.kind === "running";
  const secs = running ? Math.max(0, Math.round((now - state.since) / 1000)) : 0;
  const message =
    state.kind === "running"
      ? `Refreshing from Xero… ${secs}s`
      : state.kind === "done"
        ? state.status === "ok"
          ? "Up to date."
          : `Refresh finished with status: ${state.status}.`
        : state.kind === "error"
          ? state.message
          : busy
            ? "A refresh is running. This page updates when it finishes."
            : "";

  return (
    <div className="refresh">
      <button type="button" className="btn" onClick={refresh} disabled={running || busy} aria-busy={running}>
        {running ? "Refreshing…" : "Refresh from Xero"}
      </button>
      <span className={state.kind === "error" ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">
        {message}
      </span>
    </div>
  );
}
