/**
 * After-install check-ins (CLAUDE.md §7.6), judged only from what the ledger shows. Pure.
 *
 * Reports-first (BACKEND.md D1) means we see monthly bills per supplier and the state of each statement line,
 * not the app's own sync. So each check says exactly what it looked at:
 *   day 7   — are the app's bills reaching Xero?            (proxy for "connection producing data")
 *   day 30  — does the line it was meant to fix now count as handled?
 *   day 90  — is the line still flagged, and how far has its figure moved since install?
 *   renewal — 60 days before renewal: what they pay a month vs similar businesses (k ≥ 10, else "not enough peers").
 */
import type { CheckinKind, CheckinResult, InstallBaseline } from "@/db/schema";

export type CheckinStatus = "ok" | "not_yet" | "failed" | "info";
export type PeerBand = { n: number; p25: number; median: number; p75: number };
export type CheckinCtx = {
  kind: CheckinKind;
  appName: string;
  installedOn: string; // YYYY-MM-DD
  /** The app's billed amount per month (YYYY-MM-01 → £), from detection. Null when no bills matched. */
  monthly: Record<string, number> | null;
  baseline: InstallBaseline;
  /** The line now (latest run), or null when the install isn't tied to a line or the line is gone. */
  line: { state: string; value: number; name: string } | null;
  peer: PeerBand | null;
  /** Minimum peers before a band is shown (k-anonymity). */
  k: number;
};

export const DAYS: Record<Exclude<CheckinKind, "renewal">, number> = { d7: 7, d30: 30, d90: 90 };
export const RENEWAL_LEAD_DAYS = 60;

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const monthLabel = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const HANDLED = new Set(["covered", "fine", "marked_fine"]);

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Months with a bill, from the install month on. */
function billsSince(monthly: Record<string, number> | null, installedOn: string): [string, number][] {
  const from = `${installedOn.slice(0, 7)}-01`;
  return Object.entries(monthly ?? {})
    .filter(([m, v]) => m >= from && v > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Typical monthly cost: median of the last three billed months. */
export function typicalMonthly(monthly: Record<string, number> | null): number | null {
  const v = Object.entries(monthly ?? {})
    .filter(([, x]) => x > 0)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 3)
    .map(([, x]) => x)
    .sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2;
}

export function evaluateCheckin(c: CheckinCtx): { status: CheckinStatus; result: CheckinResult } {
  const bills = billsSince(c.monthly, c.installedOn);
  const lineName = c.line?.name ?? c.baseline.lineName ?? "the line";

  if (c.kind === "d7") {
    if (bills.length) {
      const [m, v] = bills[bills.length - 1]!;
      return { status: "ok", result: { headline: `Bills from ${c.appName} are reaching Xero`, detail: `${gbp(v)} in ${monthLabel(m)}.`, numbers: { months_billed: bills.length } } };
    }
    return { status: "not_yet", result: { headline: `No bill from ${c.appName} in Xero yet`, detail: "That's normal if it bills monthly. We look again at day 30." } };
  }

  if (c.kind === "d30") {
    if (c.line) {
      if (HANDLED.has(c.line.state)) {
        return { status: "ok", result: { headline: `${lineName} no longer needs a look`, detail: c.line.state === "covered" ? "It now counts as handled by an app you pay for." : "It isn't flagged any more." } };
      }
      return {
        status: "not_yet",
        result: {
          headline: `${lineName} is still flagged`,
          detail: bills.length ? `We can see ${c.appName} in your bills, but not yet for long enough to count it.` : `We can't see a bill from ${c.appName} yet.`,
        },
      };
    }
    return bills.length
      ? { status: "ok", result: { headline: `${c.appName} is billing you regularly`, numbers: { months_billed: bills.length } } }
      : { status: "not_yet", result: { headline: `No bill from ${c.appName} in Xero yet` } };
  }

  if (c.kind === "d90") {
    if (c.line) {
      const before = c.baseline.lineValue;
      const after = c.line.value;
      const change = before ? Math.round(((after - before) / Math.abs(before)) * 1000) / 10 : null;
      const moved = before !== null ? ` It was ${gbp(before)} when ${c.appName} went in and is ${gbp(after)} now${change !== null ? ` (${change > 0 ? "+" : ""}${change}%)` : ""}.` : "";
      const numbers = { before, after, change_pct: change };
      if (HANDLED.has(c.line.state)) return { status: "ok", result: { headline: `${lineName} is handled 90 days on`, detail: moved.trim() || undefined, numbers } };
      return { status: "failed", result: { headline: `${lineName} is still flagged 90 days on`, detail: `Worth asking whether ${c.appName} is set up fully.${moved}`, numbers } };
    }
    const recent = bills.slice(-3).length;
    return recent >= 2
      ? { status: "ok", result: { headline: `${c.appName} is still in use 90 days on`, numbers: { months_billed: bills.length } } }
      : { status: "failed", result: { headline: `Bills from ${c.appName} have stopped or never started` } };
  }

  // renewal
  const pay = typicalMonthly(c.monthly);
  if (pay === null) return { status: "info", result: { headline: `We can't see what you pay ${c.appName}`, detail: "No bills from it reached Xero, so there's nothing to compare yet." } };
  if (!c.peer || c.peer.n < c.k) {
    return { status: "info", result: { headline: `You pay about ${gbp(pay)} a month for ${c.appName}`, detail: `Not enough similar businesses yet to compare (we need ${c.k} or more).`, numbers: { monthly: pay } } };
  }
  const p = c.peer;
  const numbers = { monthly: pay, peer_p25: p.p25, peer_median: p.median, peer_p75: p.p75, peers: p.n };
  if (pay > p.p75) {
    return { status: "failed", result: { headline: `You pay more than most similar businesses for ${c.appName}`, detail: `About ${gbp(pay)} a month. Most pay ${gbp(p.p25)}–${gbp(p.p75)} (${p.n} businesses). Worth raising before you renew.`, numbers } };
  }
  return { status: "ok", result: { headline: `Your ${c.appName} price is in the usual range`, detail: `About ${gbp(pay)} a month. Most pay ${gbp(p.p25)}–${gbp(p.p75)} (${p.n} businesses).`, numbers } };
}

/** The check-ins an install gets: day 7/30/90 from install, and renewal −60 when a renewal date is known. */
export function schedule(installedOn: string, renewalOn: string | null): { kind: CheckinKind; dueOn: string }[] {
  const out: { kind: CheckinKind; dueOn: string }[] = (Object.keys(DAYS) as (keyof typeof DAYS)[]).map((k) => ({ kind: k, dueOn: addDays(installedOn, DAYS[k]) }));
  if (renewalOn) out.push({ kind: "renewal", dueOn: addDays(renewalOn, -RENEWAL_LEAD_DAYS) });
  return out;
}
