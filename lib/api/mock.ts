/**
 * Mock mode (UI-SPEC §3): answers /api/* from mocks/*.json (scripts/make-mocks.ts), shaped by ?scenario=.
 * Stateless: writes answer as the real API would (a feedback answer returns the line in its new state) but nothing
 * is saved. Every mock org is a labelled sample.
 */
import fs from "node:fs";
import path from "node:path";
import type * as T from "./types";

export const SCENARIOS = ["default", "empty", "refreshing", "refresh_failed", "unreconciled", "revoked", "lapsing", "past_due", "accountant"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const scenarioOf = (s: string | null | undefined): Scenario => (SCENARIOS.includes(s as Scenario) ? (s as Scenario) : "default");

const DIR = path.resolve(process.cwd(), "mocks");
const cache = new Map<string, unknown>();
function load<V>(rel: string): V | null {
  if (!cache.has(rel)) {
    const file = path.join(DIR, rel);
    if (!file.startsWith(DIR) || !fs.existsSync(file)) return null;
    cache.set(rel, JSON.parse(fs.readFileSync(file, "utf8")));
  }
  // A fresh copy each time: scenarios edit it.
  return structuredClone(cache.get(rel)) as V;
}

export type MockResult = { status: number; json: unknown };
const ok = (json: unknown): MockResult => ({ status: 200, json });
const err = (status: number, code: T.ErrorCode, message: string): MockResult => ({ status, json: { code, message, retryable: status >= 500, requestId: "mock", error: message } });

// ---------- scenario transforms ----------

const UNRECONCILED_DIFF = 1234.56;

function withBanner(s: T.Summary, b: T.Banner) {
  s.banners = [...s.banners.filter((x) => x.kind !== b.kind), b];
}

function summaryFor(sc: Scenario): T.Summary | null {
  const s = load<T.Summary>("summary.json");
  if (!s) return null;
  const org = load<{ defaultOrg: string }>("index.json")?.defaultOrg ?? "";
  if (sc === "empty") {
    Object.assign(s, { atStake: 0, flaggedLines: 0, appsMatched: 0, biggestLines: [], shortlistMonthly: null, shortlistUnknownPrices: 0 });
    s.trends = s.trends.map((t) => ({ ...t, flagged: false, atStake: null, band: null, flagId: null, lineKey: null }));
  }
  if (sc === "refreshing") s.refreshing = true;
  if (sc === "refresh_failed") withBanner(s, { kind: "refresh_failed", message: "Last update from Xero failed 4 Nov, 10:02.", action: { label: "Try again", href: `/app/${org}?refresh=1` } });
  if (sc === "unreconciled") withBanner(s, { kind: "cashflow_unreconciled", message: `Cash flow doesn't reconcile yet: £${UNRECONCILED_DIFF.toLocaleString("en-GB", { minimumFractionDigits: 2 })} unexplained. We're checking.` });
  if (sc === "revoked") withBanner(s, { kind: "connection_revoked", message: "Xero is disconnected for Northwind Goods Ltd (sample).", action: { label: "Reconnect", href: "/connect" } });
  if (sc === "past_due") withBanner(s, { kind: "payment_failed", message: "Your last payment failed.", action: { label: "Update card", href: `/app/${org}/billing` } });
  if (sc === "lapsing") s.questions = lapsingQuestions();
  return s;
}

function lapsingQuestions(): T.LifecycleQuestion[] {
  const d = load<{ apps: T.DetectedApp[] }>("detected-apps.json");
  const a = d?.apps.find((x) => x.state === "active") ?? d?.apps[0];
  return a ? [{ id: `lapsing:${a.appId}`, kind: "lapsing", appId: a.appId, appName: a.name, lastPaid: "2026-08-01" }] : [];
}

function detectedFor(sc: Scenario) {
  const d = load<{ apps: T.DetectedApp[]; questions: T.LifecycleQuestion[] }>("detected-apps.json");
  if (d && sc === "lapsing") {
    const q = lapsingQuestions()[0];
    if (q) {
      d.questions = [q];
      d.apps = d.apps.map((a) => (a.appId === q.appId ? { ...a, state: "lapsing", lastPaid: q.lastPaid } : a));
    }
  }
  return d;
}

function quiet(l: T.Line): T.Line {
  return l.state === "flagged" ? { ...l, state: "fine", band: null, topApp: null } : l;
}

function statementFor(kind: string, months: boolean, sc: Scenario): T.Statement | null {
  const s = load<T.Statement>(`statements/${kind}${months && kind !== "cf" ? "-12" : ""}.json`);
  if (!s) return null;
  if (sc === "empty") s.sections = s.sections.map((x) => ({ ...x, lines: x.lines.map(quiet) }));
  if (sc === "unreconciled" && kind === "cf") {
    s.reconciled = false;
    s.reconDiff = UNRECONCILED_DIFF;
    // The real API shows no flags on an unreconciled cash flow: its lines wait as "Checking".
    s.sections = s.sections.map((x) => ({ ...x, lines: x.lines.map((l) => (l.flagId ? { ...l, state: "queued" as const, band: null, topApp: null } : l)) }));
  }
  return s;
}

function runFor(sc: Scenario): T.RefreshRun | null {
  const r = load<T.RefreshRun>("refresh-run.json");
  if (!r) return null;
  if (sc === "refreshing") {
    r.status = "running";
    r.finishedAt = null;
    r.steps = r.steps.map((s, i) => ({ ...s, status: i < 4 ? "done" : i === 4 ? "running" : "pending" }));
  }
  if (sc === "refresh_failed") {
    r.status = "error";
    r.steps = r.steps.map((s, i) => ({ ...s, status: i < 2 ? "done" : i === 2 ? "error" : "pending" }));
    r.error = { code: "XERO_UNAVAILABLE", message: "The update from Xero didn't finish. Try again in a few minutes.", retryable: true, requestId: "mock" };
  }
  return r;
}

function meFor(sc: Scenario, activeOrgId?: string): T.Me | null {
  const m = load<T.Me>(sc === "accountant" ? "me-accountant.json" : "me.json");
  if (!m) return null;
  if (sc === "revoked") m.orgs = m.orgs.map((o, i) => (i === 0 ? { ...o, connection: "revoked" } : o));
  if (activeOrgId && m.orgs.some((o) => o.id === activeOrgId)) m.activeOrgId = activeOrgId;
  return m;
}

// ---------- feedback (stateless) ----------

const STATE_AFTER: Record<T.FeedbackAnswer, T.LineState | null> = { yes: null, already_use_app: "covered", no_app_needed: "marked_fine", numbers_wrong: "queued", not_now: "snoozed" };
const MESSAGES: Record<T.FeedbackAnswer, string> = {
  yes: "Thanks. That helps us check our rules.",
  already_use_app: "Got it. This line now counts as covered by the app you named.",
  no_app_needed: "Got it. We've marked this line fine.",
  numbers_wrong: "Thanks. We're checking this line. It shows as Checking until we have.",
  not_now: "Got it. Hidden until 2 Feb 2027.",
};

function lineByFlag(flagId: string): T.Line | null {
  const idx = load<{ lines: string[] }>("index.json");
  for (const k of idx?.lines ?? []) {
    const d = load<T.LineDetail>(`lines/${encodeURIComponent(k)}.json`);
    if (d?.line.flagId === flagId) return d.line;
  }
  return null;
}

function feedback(flagId: string, input: T.FeedbackInput, undo: boolean): MockResult {
  const line = lineByFlag(flagId);
  if (!line) return err(404, "NOT_FOUND", "Flag not found");
  if (undo) return ok({ line, message: "Answer removed." });
  if (input.answer === "numbers_wrong" && !input.subReason) return err(400, "VALIDATION", "Pick what's wrong with the numbers");
  const state = STATE_AFTER[input.answer];
  const after: T.Line = {
    ...line,
    ...(state ? { state } : {}),
    ...(state === "snoozed" ? { snoozedUntil: "2027-02-02" } : {}),
    ...(input.subReason === "one_off" ? { oneOffNote: "You said this is a one-off cost" } : {}),
    ...(state === "covered" ? { coveredBy: { id: input.appId ?? "declared", name: input.appName ?? input.appId ?? "Your app" } } : {}),
  };
  const result: T.FeedbackResult = { feedback: { ...input, id: "mock-feedback", createdAt: new Date().toISOString(), by: "finance.lead@example.test" }, line: after, message: MESSAGES[input.answer] };
  return ok(result);
}

// ---------- router ----------

/** `segments` is the path after /api, e.g. ["orgs", "<id>", "summary"]. */
export function mockResponse(method: string, segments: string[], query: URLSearchParams, body: unknown): MockResult {
  const sc = scenarioOf(query.get("scenario"));
  const [a, b, c, d, e] = segments;
  const m = method.toUpperCase();
  const or404 = (v: unknown, what = "Not found") => (v ? ok(v) : err(404, "NOT_FOUND", what));
  const b0 = (body ?? {}) as Record<string, unknown>;

  if (a === "me" && !b && (m === "GET" || m === "PUT")) return or404(meFor(sc));
  if (a === "me" && b === "active-org" && m === "POST") return or404(meFor(sc, String(b0.orgId ?? "")));
  if (a === "apps" && !b && m === "GET") {
    const cards = load<T.AppCard[]>("apps.json") ?? [];
    const q = query.get("q")?.toLowerCase();
    const cat = query.get("category");
    const market = query.get("market");
    return ok(cards.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!cat || x.categories.includes(cat)) && (!market || x.markets.includes(market as T.Market))));
  }
  if (a === "apps" && b && m === "GET") return or404(load(`apps/${path.basename(b)}.json`), "App not found");
  if (a === "billing" && b === "plans") return ok(load("plans.json"));
  if (a === "billing" && b === "checkout" && m === "POST") return ok({ url: "/billing/success" });
  if (a === "billing" && b === "portal" && m === "POST") return ok({ url: `/app/${String(b0.orgId ?? "")}/billing` });
  if (a === "waitlist" && m === "POST") return b0.consent === true && typeof b0.email === "string" ? ok({ ok: true }) : err(400, "VALIDATION", "Invalid request");
  if (a === "auth" && b === "logout") return { status: 204, json: null };
  if (a === "flags" && b && c === "feedback" && (m === "POST" || m === "DELETE")) return feedback(b, b0 as unknown as T.FeedbackInput, m === "DELETE");

  if (a === "orgs" && b) {
    if (c === "summary") return or404(summaryFor(sc));
    if (c === "settings") return m === "PUT" ? ok(body) : or404(load("settings.json"));
    if (c === "refresh") return or404(runFor(sc), "Run not found");
    if (c === "statements" && d) return or404(statementFor(d, query.has("months"), sc), "No statements yet. Run a refresh first.");
    if (c === "lines" && d) return or404(load(`lines/${encodeURIComponent(decodeURIComponent(d))}.json`), "Line not found");
    if (c === "detected-apps") return or404(detectedFor(sc));
    if (c === "essentials") {
      const list = load<T.Essential[]>("essentials.json") ?? [];
      return ok(m === "PUT" ? list.map((x) => (x.key === b0.key ? { ...x, covered: Boolean(b0.covered) } : x)) : list);
    }
    if (c === "shortlist") {
      const list = load<T.ShortlistItem[]>("shortlist.json") ?? [];
      if (m === "DELETE") return ok(list.filter((x) => x.appId !== b0.appId));
      if (m === "POST" && !list.some((x) => x.appId === b0.appId)) {
        const card = (load<T.AppCard[]>("apps.json") ?? []).find((x) => x.id === b0.appId);
        if (!card) return err(404, "NOT_FOUND", "Unknown app");
        list.push({ appId: card.id, appName: card.name, lineKey: (b0.lineKey as string) ?? null, lineName: null, price: card.price, addedAt: new Date().toISOString() });
      }
      return ok(list);
    }
    if (c === "subscription") {
      const s = load<T.Subscription>("subscription.json");
      return ok(sc === "past_due" ? { ...s, status: "past_due", planId: "monthly", currentPeriodEnd: "2026-12-04" } : s);
    }
    if (c === "disconnect") return { status: 204, json: null };
  }
  void e;
  return err(404, "NOT_FOUND", `No mock for ${m} /api/${segments.join("/")}`);
}
