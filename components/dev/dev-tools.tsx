"use client";

/**
 * ENGINE-V2 Phase 2: dev rail (left), pulsing review box, and the frosted-glass Engine panel (right).
 * Rendered only when the server says dev tools are on (DEV_TOOLS=true + admin). Every request it makes goes to
 * routes that check the same thing again, so hiding this component is never the security boundary.
 * What-if weights live in this component's state only: they are never saved.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { EngineTrace, TracePart } from "@/lib/rank/v2/trace";
import type { QueueSummary } from "@/lib/dev/tools";
import type { PanelLine } from "@/lib/dev/lines";

type Tab = "ranking" | "breakdown" | "compare" | "whatif" | "data" | "queue";
const TABS: { key: Tab; label: string }[] = [
  { key: "ranking", label: "Ranking" },
  { key: "breakdown", label: "Breakdown" },
  { key: "compare", label: "v1 vs v2" },
  { key: "whatif", label: "What-if" },
  { key: "data", label: "Data" },
  { key: "queue", label: "Queue" },
];
const STORE = "fs.enginePanel";
const noopSubscribe = () => () => {};
const MIN_W = 360;
const MAX_W = 720;

type Stored = { open: boolean; width: number; tab: Tab };
function load(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<Stored> | null;
    return { open: Boolean(v?.open), width: Math.min(MAX_W, Math.max(MIN_W, Number(v?.width) || 440)), tab: TABS.some((t) => t.key === v?.tab) ? (v!.tab as Tab) : "ranking" };
  } catch {
    return { open: false, width: 440, tab: "ranking" };
  }
}
function save(s: Stored) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* private window or storage blocked: the panel still works, it just won't remember */
  }
}

const GROUP: Record<string, "strength" | "fit" | "quality" | "price"> = {
  strength: "strength",
  integration_fit: "fit",
  category_match: "fit",
  function_match: "fit",
  keyword_match: "fit",
  industry_fit: "fit",
  rating_score: "quality",
  volume_score: "quality",
  award_boost: "quality",
  price: "price",
};
const GROUP_LABEL = { strength: "Strength", fit: "Fit", quality: "Quality", price: "Price" } as const;

const fmtAge = (iso: string) => {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? "under 1 h" : h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
};
const gbp = (n: number) => `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;

// ---------- what-if ----------
type W = Record<string, number>;
const WEIGHT_KEYS: { key: string; label: string; group: string }[] = [
  { key: "strength", label: "Strength", group: "Top level" },
  { key: "fit", label: "Fit", group: "Top level" },
  { key: "quality", label: "Quality", group: "Top level" },
  { key: "price", label: "Price", group: "Top level" },
  { key: "fit.integration_fit", label: "Integration fit", group: "Inside fit" },
  { key: "fit.job_fit", label: "Job fit", group: "Inside fit" },
  { key: "job_fit.category_match", label: "Category", group: "Inside job fit" },
  { key: "job_fit.function_match", label: "Xero functions", group: "Inside job fit" },
  { key: "job_fit.keyword_match", label: "Keywords", group: "Inside job fit" },
  { key: "job_fit.industry_fit", label: "Industry", group: "Inside job fit" },
  { key: "quality.rating_score", label: "Rating", group: "Inside quality" },
  { key: "quality.volume_score", label: "Review volume", group: "Inside quality" },
];

/** The match from a trace's normalised inputs under other weights (same formula as lib/rank/v2/score.ts). */
export function rematch(parts: TracePart[], w: W): number {
  const v = Object.fromEntries(parts.map((p) => [p.key, p.normalised])) as Record<string, number>;
  const n = (k: string) => v[k] ?? 0.5;
  const job = w["job_fit.category_match"]! * n("category_match") + w["job_fit.function_match"]! * n("function_match") + w["job_fit.keyword_match"]! * n("keyword_match") + (w["job_fit.industry_fit"] ?? 0) * n("industry_fit");
  const fit = w["fit.integration_fit"]! * n("integration_fit") + w["fit.job_fit"]! * job;
  const quality = Math.min(1, Math.max(0, w["quality.rating_score"]! * n("rating_score") + w["quality.volume_score"]! * n("volume_score") + (v.award_boost ?? 0)));
  return Math.round(100 * (w.strength! * n("strength") + w.fit! * fit + w.quality! * quality + w.price! * n("price")) * 100) / 100;
}

function toYaml(w: W): string {
  return [
    "scoring_v2:",
    `  weights: { strength: ${w.strength}, fit: ${w.fit}, quality: ${w.quality}, price: ${w.price} }`,
    `  fit: { integration_fit: ${w["fit.integration_fit"]}, job_fit: ${w["fit.job_fit"]} }`,
    `  job_fit: { category_match: ${w["job_fit.category_match"]}, function_match: ${w["job_fit.function_match"]}, keyword_match: ${w["job_fit.keyword_match"]}, industry_fit: ${w["job_fit.industry_fit"] ?? 0} }`,
    `  quality: { rating_score: ${w["quality.rating_score"]}, volume_score: ${w["quality.volume_score"]} }`,
  ].join("\n");
}

// ---------- component ----------
export function DevTools(props: { org: string | null; lines: PanelLine[]; initialSummary: QueueSummary }) {
  const { org, lines } = props;
  const pathname = usePathname();
  const [summary, setSummary] = useState<QueueSummary>(props.initialSummary);
  const [peek, setPeek] = useState(false);
  // Remembered state (localStorage, falls back to minimised). Read once on the client, never during server render.
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [changed, setChanged] = useState<Stored | null>(null);
  const initial = useMemo<Stored>(() => (ready ? load() : { open: false, width: 440, tab: "ranking" }), [ready]);
  const state: Stored = changed ?? initial;
  const setState = useCallback((f: (s: Stored) => Stored) => setChanged((c) => f(c ?? initial)), [initial]);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (changed) save(changed);
  }, [changed]);

  // Review queue summary: every 30 s while the tab is visible.
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/admin/queue/summary", { cache: "no-store" });
        if (r.ok && !stop) setSummary((await r.json()) as QueueSummary);
      } catch {
        /* offline: keep the last numbers */
      }
    };
    const t = setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  const setOpen = useCallback((open: boolean) => setState((s) => ({ ...s, open })), [setState]);

  // Ctrl+Shift+E / ⌘⇧E toggles; Esc minimises.
  useEffect(() => {
    if (!org) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setState((s) => ({ ...s, open: !s.open }));
      } else if (e.key === "Escape" && state.open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [org, state.open, setOpen, setState]);

  // Focus into the panel on open; back to the rail button on minimise.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (state.open && !wasOpen.current) panelHeading.current?.focus();
    if (!state.open && wasOpen.current) toggleRef.current?.focus();
    wasOpen.current = state.open;
  }, [state.open, ready]);

  const onLine = pathname.match(/^\/app\/[^/]+\/lines\/([^/?#]+)/)?.[1];
  const flaggedCount = lines.filter((l) => l.state === "flagged").length;

  return (
    <>
      <nav className="dev-rail" aria-label="Developer tools">
        <span className="dev-rail-title">Dev</span>
        {org ? (
          <button ref={toggleRef} type="button" className={`dev-rail-item${state.open ? " on" : ""}`} aria-pressed={state.open} onClick={() => setOpen(!state.open)} title="Engine panel (Ctrl+Shift+E)">
            Engine
          </button>
        ) : null}
        <div className="dev-review" onMouseEnter={() => setPeek(true)} onMouseLeave={() => setPeek(false)}>
          <button
            type="button"
            className={`dev-rail-item dev-review-box${summary.total ? (summary.high ? " pulse-high" : " pulse") : ""}`}
            aria-expanded={peek}
            onClick={() => setPeek((p) => !p)}
            aria-label={`Review queue: ${summary.total} open${summary.high ? `, ${summary.high} high priority` : ""}`}
          >
            Review
            <span className="dev-count">{summary.total}</span>
          </button>
          {peek ? (
            <div className="dev-peek" role="dialog" aria-label="Oldest open review items">
              <p className="dev-peek-head">
                {summary.total} open{summary.high ? ` · ${summary.high} high` : ""} · <a href="/admin/queue">All items</a>
              </p>
              {summary.oldest.length ? (
                <ul>
                  {summary.oldest.map((i) => (
                    <li key={i.id}>
                      <a href={`/admin/queue?item=${i.id}#item-${i.id}`}>
                        {i.priority === "high" ? <b>High · </b> : null}
                        {i.label}
                      </a>
                      <span className="muted small">
                        {" "}
                        {i.org ?? "no business"} · {fmtAge(i.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Nothing waiting.</p>
              )}
            </div>
          ) : null}
        </div>
        <a className="dev-rail-item" href="/admin/queue#user_report">Reports</a>
        <a className="dev-rail-item" href="/admin/testers">Testers</a>
        {org ? <a className="dev-rail-item" href={`/admin/debug/${org}`}>Debug</a> : null}
        <span className="dev-rail-item disabled" title="Scenario checks arrive in Phase 4">Checks</span>
        <a className="dev-rail-item" href="/admin/engine-v2">Weights</a>
      </nav>

      {org && ready ? (
        state.open ? (
          <EnginePanel
            org={org}
            lines={lines}
            lineKey={onLine ? decodeURIComponent(onLine) : null}
            width={state.width}
            tab={state.tab}
            setWidth={(width) => setState((s) => ({ ...s, width }))}
            setTab={(tab) => setState((s) => ({ ...s, tab }))}
            onMinimise={() => setOpen(false)}
            headingRef={panelHeading}
          />
        ) : (
          <button type="button" className="dev-pill" onClick={() => setOpen(true)} aria-label="Open the Engine panel">
            Engine · v2 · {flaggedCount} flag{flaggedCount === 1 ? "" : "s"}
          </button>
        )
      ) : null}
    </>
  );
}

function EnginePanel(props: {
  org: string;
  lines: PanelLine[];
  lineKey: string | null;
  width: number;
  tab: Tab;
  setWidth: (w: number) => void;
  setTab: (t: Tab) => void;
  onMinimise: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const { org, lines, tab, setTab, lineKey: routeLine, width, setWidth, onMinimise, headingRef } = props;
  const [picked, setPicked] = useState<string | null>(routeLine ?? lines[0]?.lineKey ?? null);
  const lineKey = routeLine ?? picked;
  // Loaded data is keyed by line, so switching lines shows "working" without resetting state inside an effect.
  const [data, setData] = useState<{ key: string; v2: EngineTrace | null; v1: EngineTrace | null; err: string | null }>({ key: "", v2: null, v1: null, err: null });
  const cur = data.key === lineKey ? data : { key: lineKey ?? "", v2: null, v1: null, err: null };
  const { v2, v1, err } = cur;
  const [chosen, setAppId] = useState<string | null>(null);
  const appId = v2 && chosen && v2.candidates.some((c) => c.appId === chosen) ? chosen : (v2?.candidates[0]?.appId ?? null);
  const [what, setWhat] = useState<{ key: string; w: W } | null>(null);
  const w = what && what.key === lineKey ? what.w : (v2?.weights ?? null);
  const setW = (nw: W) => setWhat({ key: lineKey ?? "", w: nw });

  useEffect(() => {
    if (!lineKey) return;
    let stop = false;
    const get = async (engine: "v1" | "v2") => {
      const r = await fetch(`/api/dev/engine/${org}/${encodeURIComponent(lineKey)}?engine=${engine}`, { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
      return body as EngineTrace;
    };
    get("v2")
      .then((t) => !stop && setData((d) => ({ ...(d.key === lineKey ? d : { v1: null }), key: lineKey, v2: t, err: null })))
      .catch((e: Error) => !stop && setData((d) => ({ ...(d.key === lineKey ? d : { v1: null, v2: null }), key: lineKey, err: e.message })));
    get("v1")
      .then((t) => !stop && setData((d) => ({ ...(d.key === lineKey ? d : { v2: null, err: null }), key: lineKey, v1: t })))
      .catch(() => {
        /* v1 has no shortlist for some lines; the compare tab says so */
      });
    return () => {
      stop = true;
    };
  }, [org, lineKey]);

  // Resize from the left edge.
  const drag = useRef<{ x: number; w: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, w: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setWidth(Math.min(MAX_W, Math.max(MIN_W, drag.current.w + (drag.current.x - e.clientX))));
  };
  const onPointerUp = () => (drag.current = null);

  const download = () => {
    if (!v2) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(v2, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `engine-trace-${v2.lineKey.replace(/[^a-z0-9]+/gi, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const line = lines.find((l) => l.lineKey === lineKey);
  const selected = v2?.candidates.find((c) => c.appId === appId) ?? null;

  return (
    <aside className="dev-panel" role="complementary" aria-labelledby="dev-panel-title" style={{ width }}>
      <div className="dev-resize" role="separator" aria-orientation="vertical" aria-label="Resize the Engine panel" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      <div className="dev-panel-head">
        <h2 id="dev-panel-title" ref={headingRef} tabIndex={-1}>
          Engine · v2
        </h2>
        <span className="muted small">shadow: customers see v1</span>
        <span className="dev-panel-actions">
          <button type="button" className="link-btn" onClick={download} disabled={!v2}>
            Download trace (JSON)
          </button>
          <button type="button" className="link-btn" onClick={onMinimise} aria-label="Minimise the Engine panel (Esc)">
            Minimise
          </button>
        </span>
      </div>

      {routeLine ? (
        <p className="small">
          Line: <b>{line?.name ?? routeLine}</b> {line ? `· ${gbp(line.value)} · ${line.state}` : ""}
        </p>
      ) : (
        <label className="small dev-picker">
          Line{" "}
          <select value={picked ?? ""} onChange={(e) => setPicked(e.target.value)}>
            {lines.map((l) => (
              <option key={l.lineKey} value={l.lineKey}>
                {l.name} · {gbp(l.value)} · {l.state}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="tabs dev-tabs" role="tablist" aria-label="Engine panel">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="dev-panel-body" role="tabpanel">
        {!lineKey ? <p className="muted">No flagged or covered lines in the latest refresh.</p> : null}
        {err ? (
          <p className="dev-error" role="alert">
            Couldn&apos;t load the trace: {err}
          </p>
        ) : null}
        {lineKey && !v2 && !err ? <p className="muted">Working out the ranking…</p> : null}
        {v2 && tab === "ranking" ? <RankingTab t={v2} selected={appId} onSelect={(id) => (setAppId(id), setTab("breakdown"))} /> : null}
        {v2 && tab === "breakdown" ? (selected ? <BreakdownTab c={selected} /> : <p className="muted">Pick an app on the Ranking tab.</p>) : null}
        {v2 && tab === "compare" ? <CompareTab v1={v1} v2={v2} /> : null}
        {v2 && tab === "whatif" && w ? <WhatIfTab t={v2} w={w} setW={setW} /> : null}
        {tab === "data" ? appId ? <DataTab appId={appId} /> : <p className="muted">Pick an app on the Ranking tab.</p> : null}
        {tab === "queue" ? <QueueTab org={org} /> : null}
      </div>
    </aside>
  );
}

function Stack({ parts, max }: { parts: TracePart[]; max: number }) {
  const g = { strength: 0, fit: 0, quality: 0, price: 0 };
  for (const p of parts) g[GROUP[p.key] ?? "fit"] += Math.max(0, p.contribution);
  return (
    <span className="dev-stack" aria-hidden="true">
      {(Object.keys(g) as (keyof typeof g)[]).map((k) => (
        <span key={k} className={`seg-${k}`} style={{ width: `${(g[k] / (max || 100)) * 100}%` }} title={`${GROUP_LABEL[k]}: ${g[k].toFixed(1)}`} />
      ))}
    </span>
  );
}

function RankingTab({ t, selected, onSelect }: { t: EngineTrace; selected: string | null; onSelect: (id: string) => void }) {
  const max = Math.max(1, ...t.candidates.map((c) => c.match));
  return (
    <>
      {t.warnings.length ? (
        <ul className="dev-warnings">
          {t.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <p className="small muted dev-legend">
        <span className="seg-strength" /> Strength <span className="seg-fit" /> Fit <span className="seg-quality" /> Quality <span className="seg-price" /> Price
      </p>
      <ol className="dev-rank">
        {t.candidates.map((c) => (
          <li key={c.appId} className={c.appId === selected ? "on" : ""}>
            <button type="button" className="dev-rank-row" onClick={() => onSelect(c.appId)}>
              <span className="dev-rank-n">{c.rank}</span>
              <span className="dev-rank-name">
                {c.name}
                {c.inUse ? <span className="tag">in use</span> : c.kind === "change" ? <span className="muted small"> change</span> : null}
              </span>
              <span className="num">{c.match.toFixed(1)}</span>
              <Stack parts={c.parts} max={max} />
            </button>
          </li>
        ))}
      </ol>
      {t.excluded.length ? (
        <details>
          <summary>Left out ({t.excluded.length})</summary>
          <ul className="small">
            {t.excluded.map((x) => (
              <li key={x.appId}>
                {x.name}: {x.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="small muted">
        Rules {t.rulesVersion} · computed {new Date(t.computedAt).toLocaleTimeString("en-GB")}
      </p>
    </>
  );
}

function BreakdownTab({ c }: { c: EngineTrace["candidates"][number] }) {
  const starts = c.parts.map((_, i) => c.parts.slice(0, i).reduce((t, p) => t + p.contribution, 0));
  return (
    <>
      <h3>
        #{c.rank} {c.name} · {c.match.toFixed(2)}
      </h3>
      <pre className="dev-formula">{c.formula}</pre>
      <div className="table-scroll">
        <table className="tbl dev-parts">
          <thead>
            <tr>
              <th>Input</th>
              <th className="num">Score</th>
              <th className="num">Weight</th>
              <th className="num">Adds</th>
            </tr>
          </thead>
          <tbody>
            {c.parts.map((p) => (
              <tr key={p.key} className={p.missing ? "dev-missing" : ""}>
                <td>
                  {p.label}
                  {p.missing ? <span className="tag">missing</span> : null}
                  {p.note ? <div className="small muted">{p.note}</div> : null}
                  <code className="dev-raw">{typeof p.raw === "object" ? JSON.stringify(p.raw) : String(p.raw)}</code>
                  {p.source ? (
                    <div className="small muted">
                      {p.source.url ? (
                        <a href={p.source.url} target="_blank" rel="noreferrer">
                          {p.source.label}
                        </a>
                      ) : (
                        p.source.label
                      )}
                      {p.source.capturedAt ? `, captured ${p.source.capturedAt}` : ""}
                    </div>
                  ) : null}
                </td>
                <td className="num">{p.normalised.toFixed(2)}</td>
                <td className="num">{(p.weight * 100).toFixed(1)}%</td>
                <td className="num">{p.contribution.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="stat-label">From 0 to {c.match.toFixed(1)}</p>
      <div className="dev-waterfall" aria-label="Waterfall from 0 to the match">
        {c.parts.map((p, i) => {
          const left = starts[i]!;
          return (
            <div key={p.key} className="dev-wf-row">
              <span className="dev-wf-label small">{p.label}</span>
              <span className="dev-wf-track">
                <span className={`dev-wf-bar seg-${GROUP[p.key] ?? "fit"}`} style={{ left: `${left}%`, width: `${Math.max(0.3, p.contribution)}%` }} />
              </span>
              <span className="num small">+{p.contribution.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CompareTab({ v1, v2 }: { v1: EngineTrace | null; v2: EngineTrace }) {
  if (!v1 || !v1.candidates.length) return <p className="muted">v1 has no shortlist for this line.</p>;
  const v1Rank = new Map(v1.candidates.map((c) => [c.appId, c.rank]));
  const mean = new Map<string, number>();
  for (const p of v2.candidates[0]?.parts ?? []) mean.set(p.key, v2.candidates.reduce((t, c) => t + (c.parts.find((x) => x.key === p.key)?.contribution ?? 0), 0) / v2.candidates.length);
  const reason = (c: EngineTrace["candidates"][number]) => {
    const best = [...c.parts].sort((a, b) => b.contribution - (mean.get(b.key) ?? 0) - (a.contribution - (mean.get(a.key) ?? 0)))[0];
    return best ? `${best.label} ${best.note ? `(${best.note})` : ""}` : "";
  };
  const top = v2.candidates.slice(0, 10);
  return (
    <div className="two-col dev-compare">
      <div>
        <p className="stat-label">v1 (what customers see)</p>
        <ol className="small">
          {v1.candidates.map((c) => (
            <li key={c.appId}>
              {c.name} <span className="num">{c.match}</span>
              {c.inUse ? <span className="tag">in use</span> : null}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <p className="stat-label">v2 (shadow), top 10</p>
        <ol className="small">
          {top.map((c) => {
            const was = v1Rank.get(c.appId);
            const move = was === undefined ? "new" : was === c.rank ? "=" : was > c.rank ? `↑${was - c.rank}` : `↓${c.rank - was}`;
            return (
              <li key={c.appId}>
                {c.name} <span className="num">{c.match.toFixed(1)}</span> <b>{move}</b>
                <div className="muted">{reason(c)}</div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function WhatIfTab({ t, w, setW }: { t: EngineTrace; w: W; setW: (w: W) => void }) {
  const ranked = useMemo(
    () =>
      t.candidates
        .map((c) => ({ c, m: rematch(c.parts, w) }))
        .sort((a, b) => b.m - a.m || a.c.rank - b.c.rank)
        .slice(0, 10),
    [t, w],
  );
  const [copied, setCopied] = useState(false);
  const top = w.strength! + w.fit! + w.quality! + w.price!;
  const groups = [...new Set(WEIGHT_KEYS.map((k) => k.group))];
  return (
    <>
      <p className="dev-experiment">Experiment: not saved. Changes here re-rank this line only, in your browser.</p>
      {groups.map((g) => (
        <fieldset key={g} className="dev-sliders">
          <legend>{g}</legend>
          {WEIGHT_KEYS.filter((k) => k.group === g).map((k) => (
            <label key={k.key}>
              <span>{k.label}</span>
              <input type="range" min={0} max={1} step={0.01} value={w[k.key] ?? 0} onChange={(e) => setW({ ...w, [k.key]: Number(e.target.value) })} />
              <span className="num">{(w[k.key] ?? 0).toFixed(2)}</span>
            </label>
          ))}
        </fieldset>
      ))}
      {Math.abs(top - 1) > 0.001 ? <p className="small dev-error">Top-level weights add up to {top.toFixed(2)}, not 1.</p> : null}
      <p>
        <button type="button" className="link-btn" onClick={() => setW({ ...t.weights })}>
          Reset to rules.yaml
        </button>{" "}
        ·{" "}
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(toYaml(w)).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy as YAML"}
        </button>
      </p>
      <ol className="small">
        {ranked.map(({ c, m }, i) => (
          <li key={c.appId}>
            {c.name} <span className="num">{m.toFixed(1)}</span>
            {c.rank !== i + 1 ? <b> (was #{c.rank})</b> : null}
          </li>
        ))}
      </ol>
    </>
  );
}

type AppRecord = {
  id: string;
  name: string;
  inCatalogue: boolean;
  categories: string[];
  markets: string[];
  functions: string[];
  industries: string[];
  listing: {
    source_url: string | null;
    captured_at: string;
    description: string | null;
    rating_avg: number | null;
    review_count: number | null;
    awards: { name: string; year: number; region: string; level: string }[];
    pricing_tiers: { name: string; price_gbp: number | null; period: string; unit: string; original?: { amount: number; currency: string } }[];
  } | null;
  completeness: { present: number; of: number; fields: { field: string; present: boolean }[] };
};

function DataTab({ appId }: { appId: string }) {
  const [got, setGot] = useState<{ id: string; rec: AppRecord | null; err: string | null }>({ id: "", rec: null, err: null });
  const { rec, err } = got.id === appId ? got : { rec: null, err: null };
  useEffect(() => {
    let stop = false;
    fetch(`/api/dev/appdb/${encodeURIComponent(appId)}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? (r.json() as Promise<AppRecord>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((x) => !stop && setGot({ id: appId, rec: x, err: null }))
      .catch((e: Error) => !stop && setGot({ id: appId, rec: null, err: e.message }));
    return () => {
      stop = true;
    };
  }, [appId]);
  if (err) return <p className="dev-error">Couldn&apos;t load the record: {err}</p>;
  if (!rec) return <p className="muted">Loading…</p>;
  const l = rec.listing;
  return (
    <>
      <h3>
        {rec.name} <span className="muted small">({rec.id})</span>
      </h3>
      <p className="small">
        {rec.inCatalogue ? "In our catalogue" : "Xero directory only"} · data {rec.completeness.present} of {rec.completeness.of}:{" "}
        {rec.completeness.fields.map((f) => (
          <span key={f.field} className={f.present ? "" : "dev-missing-word"}>
            {f.field}
            {f.present ? "" : " (missing)"}
            {" · "}
          </span>
        ))}
      </p>
      <table className="tbl small">
        <tbody>
          <tr>
            <td>Our categories</td>
            <td>{rec.categories.join(", ") || "–"}</td>
          </tr>
          <tr>
            <td>Markets</td>
            <td>{rec.markets.join(", ") || "not known"}</td>
          </tr>
          <tr>
            <td>Xero functions</td>
            <td>{rec.functions.join(", ") || "–"}</td>
          </tr>
          <tr>
            <td>Industries</td>
            <td>{rec.industries.join(", ") || "–"}</td>
          </tr>
          <tr>
            <td>Rating</td>
            <td>{l?.rating_avg != null ? `${l.rating_avg} from ${l.review_count} reviews (Xero App Store, captured ${l.captured_at})` : "no rating"}</td>
          </tr>
          <tr>
            <td>Prices</td>
            <td>
              {l?.pricing_tiers.length
                ? l.pricing_tiers.map((p) => `${p.name}: ${p.price_gbp === null ? "not published" : `£${p.price_gbp}/${p.period} ${p.unit}`}${p.original ? ` (${p.original.currency} ${p.original.amount})` : ""}`).join(" · ")
                : "not published"}
            </td>
          </tr>
          <tr>
            <td>Xero Awards</td>
            <td>{l?.awards.length ? l.awards.map((a) => `${a.name} ${a.year} ${a.level} (${a.region})`).join(" · ") : "none"}</td>
          </tr>
          <tr>
            <td>Source</td>
            <td>
              {l?.source_url ? (
                <a href={l.source_url} target="_blank" rel="noreferrer">
                  {l.source_url}
                </a>
              ) : (
                "–"
              )}
              {l ? `, captured ${l.captured_at}` : ""}
            </td>
          </tr>
        </tbody>
      </table>
      {l?.description ? (
        <>
          <p className="stat-label">Description (admins only)</p>
          <p className="small">{l.description}</p>
        </>
      ) : null}
    </>
  );
}

function QueueTab({ org }: { org: string }) {
  const [s, setS] = useState<QueueSummary | null>(null);
  useEffect(() => {
    let stop = false;
    fetch(`/api/admin/queue/summary?org=${org}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<QueueSummary>) : null))
      .then((x) => !stop && setS(x));
    return () => {
      stop = true;
    };
  }, [org]);
  if (!s) return <p className="muted">Loading…</p>;
  if (!s.total) return <p className="muted">No open review items for this business.</p>;
  return (
    <>
      <ul className="small">
        {s.byKind.map((k) => (
          <li key={k.kind}>
            {k.label}: {k.normal + k.high}
            {k.high ? <b> ({k.high} high)</b> : null}
          </li>
        ))}
      </ul>
      <p className="stat-label">Oldest</p>
      <ul className="small">
        {s.oldest.map((i) => (
          <li key={i.id}>
            <a href={`/admin/queue?item=${i.id}#item-${i.id}`}>{i.label}</a> <span className="muted">· {fmtAge(i.createdAt)}</span>
          </li>
        ))}
      </ul>
      <p className="small">
        <a href="/admin/queue">Open the review queue</a>
      </p>
    </>
  );
}
