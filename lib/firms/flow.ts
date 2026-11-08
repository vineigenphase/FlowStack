/**
 * Practice home helpers (CLAUDE.md §1 Firm UX). Pure.
 *
 * Flow bar: five segments a partner reads at a glance. Each is built from stack-map jobs:
 *   sales       ← EPOS and ecommerce sales
 *   payroll     ← payroll, rota and time
 *   purchases   ← data capture, spend and payables, inventory
 *   collections ← billing and receivables
 *   payments    ← FX and global banking
 * A segment is "by hand" if any of its jobs is a gap, "part manual" if any is part manual, "clean" if a job is
 * connected, and "quiet" when none of its jobs shows up in the client's figures.
 */
import type { FunctionStatus, MapFunction } from "@/lib/map/build";

export const SEGMENTS = [
  { key: "sales", label: "Sales", jobs: ["epos_ecommerce"] },
  { key: "payroll", label: "Payroll", jobs: ["payroll", "rota"] },
  { key: "purchases", label: "Purchases", jobs: ["data_capture", "spend_payables", "inventory"] },
  { key: "collections", label: "Collections", jobs: ["billing_receivables"] },
  { key: "payments", label: "Payments", jobs: ["fx_banking"] },
] as const;

export type SegmentState = "clean" | "part_manual" | "by_hand" | "checking" | "quiet";
export const SEGMENT_LABEL: Record<SegmentState, string> = {
  clean: "Clean",
  part_manual: "Part manual",
  by_hand: "By hand",
  checking: "Being checked",
  quiet: "Not in their figures",
};

const RANK: Record<FunctionStatus, number> = { gap: 4, part_manual: 3, checking: 2, connected: 1, quiet: 0 };
const TO_SEGMENT: Record<FunctionStatus, SegmentState> = { gap: "by_hand", part_manual: "part_manual", checking: "checking", connected: "clean", quiet: "quiet" };

export function flowSegments(functions: Pick<MapFunction, "key" | "status">[]): { key: string; label: string; state: SegmentState }[] {
  return SEGMENTS.map((s) => {
    const fns = functions.filter((f) => (s.jobs as readonly string[]).includes(f.key));
    const worst = fns.reduce<FunctionStatus>((w, f) => (RANK[f.status] > RANK[w] ? f.status : w), "quiet");
    return { key: s.key, label: s.label, state: TO_SEGMENT[worst] };
  });
}

export type Drift = { job: string; want: string; have: string[]; kind: "missing" | "different" };

/**
 * Playbook drift: for each job in the firm's playbook for this industry, the client either uses the playbook app,
 * uses something else in that job ("different"), or has nothing there ("missing").
 */
export function driftFor(playbook: { jobKey: string; appId: string }[], inUseByJob: Map<string, string[]>): Drift[] {
  const out: Drift[] = [];
  for (const p of playbook) {
    const have = inUseByJob.get(p.jobKey) ?? [];
    if (have.includes(p.appId)) continue;
    out.push({ job: p.jobKey, want: p.appId, have, kind: have.length ? "different" : "missing" });
  }
  return out;
}
