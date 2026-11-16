/**
 * Labelled set review (NEXT-STEPS P1.7). The labels were drafted by Claude; a person must check them before the
 * eval gate counts. Export one CSV row per line (line, our state, expected state, reason), the reviewer fills
 * `reviewer_state` / `reviewer_note` where they disagree (or "ok" to confirm), then import records the corrections
 * and the sign-off on each org's file.
 */
import fs from "node:fs";
import path from "node:path";
import { LabelledOrg, type LineResult } from "./run";

export const HEADER = ["org", "line_key", "line_name", "our_state", "expected_state", "reason", "reviewer_state", "reviewer_note"] as const;
const STATES = ["flagged", "covered", "fine", "marked_fine", "snoozed", "queued"] as const;

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(results: LineResult[]): string {
  const rows = [...results].sort((a, b) => a.org.localeCompare(b.org) || a.lineKey.localeCompare(b.lineKey));
  const lines = [HEADER.join(",")];
  for (const r of rows) lines.push([r.org, r.lineKey, r.name ?? "", r.predicted, r.expected, r.why ?? "", "", ""].map(cell).join(","));
  return lines.join("\n") + "\n";
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  if (f !== "" || row.length) {
    row.push(f);
    if (row.some((x) => x !== "")) rows.push(row);
  }
  return rows;
}

export type ImportResult = { changed: { org: string; lineKey: string; from: string; to: string }[]; confirmed: number; orgs: string[]; problems: string[] };

/**
 * Apply a reviewed sheet: reviewer_state = a state → becomes the label (reviewer_note becomes the reason);
 * "ok" or empty → the draft stands. Every org in the sheet is signed off by `by`.
 */
export function importReview(csv: string, by: string, dir: string, now = new Date()): ImportResult {
  const [head, ...rows] = parseCsv(csv);
  const col = (name: (typeof HEADER)[number]) => head!.indexOf(name);
  if (!head || HEADER.some((h) => col(h) < 0)) throw new Error(`The sheet needs the columns: ${HEADER.join(", ")}`);
  const out: ImportResult = { changed: [], confirmed: 0, orgs: [], problems: [] };
  const files = new Map<string, LabelledOrg>();
  for (const r of rows) {
    const org = r[col("org")]!;
    const key = r[col("line_key")]!;
    const state = (r[col("reviewer_state")] ?? "").trim().toLowerCase();
    const note = (r[col("reviewer_note")] ?? "").trim();
    if (!files.has(org)) {
      const file = path.join(dir, `${org}.json`);
      if (!fs.existsSync(file)) {
        out.problems.push(`no labelled file for ${org}`);
        continue;
      }
      files.set(org, LabelledOrg.parse(JSON.parse(fs.readFileSync(file, "utf8"))));
    }
    const l = files.get(org)!;
    if (!state || state === "ok") {
      out.confirmed++;
      continue;
    }
    if (!STATES.includes(state as (typeof STATES)[number])) {
      out.problems.push(`${org} ${key}: "${state}" isn't a state (use ${STATES.join(", ")} or ok)`);
      continue;
    }
    const from = r[col("expected_state")]!;
    l.expected[key] = state as (typeof STATES)[number];
    if (note) l.why[key] = note;
    if (from !== state) out.changed.push({ org, lineKey: key, from, to: state });
  }
  if (out.problems.length) return out; // nothing written: fix the sheet first
  for (const [org, l] of files) {
    l.labelled_by = `${by} (reviewed ${now.toISOString().slice(0, 10)}); drafted by Claude`;
    l.signed_off = { by, at: now.toISOString() };
    const file = path.join(dir, `${org}.json`);
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(file, JSON.stringify({ ...raw, labelled_by: l.labelled_by, signed_off: l.signed_off, expected: l.expected, why: l.why }, null, 2) + "\n", "utf8");
    out.orgs.push(org);
  }
  return out;
}
