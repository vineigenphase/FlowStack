/** UI-SPEC §8 contract: read models in the spec's shapes, feedback sub-reasons + undo, shortlist, essentials, waitlist. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { flags, lineOverrides, orgs, reviewQueue, users, waitlist } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { submitFeedback, undoFeedback } from "@/lib/feedback";
import * as C from "@/lib/api/contract";
import { joinWaitlist } from "@/lib/waitlist";
import { handle, HttpError } from "@/lib/api";
import type * as T from "@/lib/api/types";

let close: () => Promise<void>;
let orgId: string;
let runId: string;

beforeAll(async () => {
  close = (await freshDb()).close;
  const db = await adminDb();
  orgId = (await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true, industry: "hospitality" }).returning())[0]!.id;
  runId = (await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") })).runId;
});
afterAll(() => close());

const flagFor = async (lineKey: string) => (await withOrg(orgId, (tx) => tx.select().from(flags).where(eq(flags.lineKey, lineKey))))[0]!;
const LINE_STATES: T.LineState[] = ["flagged", "covered", "fine", "marked_fine", "queued", "snoozed"];

describe("read models", () => {
  it("summary: hero number, counts, biggest 5 flagged lines by value, sample banner", async () => {
    const s = (await C.summary(orgId))!;
    expect(s.period.label).toMatch(/^Year to date \(/);
    expect(s.atStake).toBeGreaterThan(0);
    expect(s.flaggedLines).toBeGreaterThan(0);
    expect(s.totalLines).toBeGreaterThan(s.flaggedLines);
    expect(s.biggestLines.length).toBeLessThanOrEqual(5);
    expect(s.biggestLines.every((l) => l.state === "flagged" && l.band !== null)).toBe(true);
    const v = s.biggestLines.map((l) => Math.abs(l.value));
    expect(v).toEqual([...v].sort((a, b) => b - a));
    expect(s.banners.map((b) => b.kind)).toContain("sample");
    expect(s.shortlistMonthly).toBeNull(); // nothing shortlisted, and prices are never estimated
    expect(s.sample).toBe(true);
  });

  it("statement: sections with totals, lines with the spec's states, share of base; cash flow carries reconciliation", async () => {
    const pl = (await C.statement(orgId, "pl"))!;
    expect(pl.label).toBe("Profit and loss");
    expect(pl.base.label).toBe("Revenue");
    expect(pl.reconciled).toBeNull();
    const lines = pl.sections.flatMap((s) => s.lines);
    expect(lines.every((l) => LINE_STATES.includes(l.state))).toBe(true);
    for (const s of pl.sections) expect(s.total).toBeCloseTo(s.lines.reduce((t, l) => t + l.value, 0), 2);
    const covered = lines.find((l) => l.state === "covered");
    if (covered) expect(covered.coveredBy?.name).toBeTruthy();
    const cf = (await C.statement(orgId, "cf"))!;
    expect(cf.derived).toBe(true);
    expect(typeof cf.reconciled).toBe("boolean");
    const bs = (await C.statement(orgId, "bs"))!;
    expect(bs.period.from).toBeNull();
    expect(bs.period.label).toMatch(/^As at /);
  });

  it("line detail: evidence, cause, recommendations with the 50/35/10/5 weights, in-use app has no kind", async () => {
    const d = (await C.lineDetail(orgId, "pl:310"))!;
    expect(d.statementKind).toBe("pl");
    expect(d.evidence.runId).toBe(runId);
    expect(d.evidence.trialBalance?.asAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.cause).toBeTruthy();
    expect(d.recommendations.length).toBeGreaterThan(0);
    for (const r of d.recommendations) {
      expect(r.weights).toEqual({ strength: 0.5, fit: 0.35, peers: 0.1, price: 0.05 });
      expect(r.match).toBeGreaterThanOrEqual(0);
      expect(r.kind === null).toBe(r.inUse);
      // Seeded facts are "missing": a missing price never shows a value.
      if (r.app.price.state === "missing") expect(r.app.price.value).toBeNull();
    }
    expect(await C.lineDetail(orgId, "pl:does-not-exist")).toBeNull();
  });

  it("refresh run: done/error step labels in plain words", async () => {
    const r = (await C.refreshRun(orgId, runId))!;
    expect(r.status).toBe("ok");
    expect(r.steps.every((s) => s.status === "done" && s.label.length > 0)).toBe(true);
    expect(r.steps.find((s) => s.key === "apps")?.label).toBe("Supplier spend");
    expect(await C.refreshRun(orgId, "not-a-uuid")).toBeNull();
  });

  it("settings: contract shape; benchmark opt-in is the stored price-sharing consent; finer industries read as other", async () => {
    expect(await C.settingsOf(orgId)).toEqual({ markets: ["UK"], industry: "other", includeCurrentMonth: false, benchmarkOptIn: false, digestOptIn: false });
  });

  it("detected apps and plans", async () => {
    const d = await C.detectedAppsView(orgId);
    expect(d.apps.length).toBeGreaterThan(0);
    expect(d.apps.every((a) => ["new", "active", "lapsing", "inactive", "declared"].includes(a.state))).toBe(true);
    const plans = C.plansView();
    expect(plans.map((p) => p.id)).toEqual(["monthly", "annual", "audit_only"]);
    expect(plans.every((p) => p.priceGbp === null)).toBe(true); // prices are OPEN
    expect(plans.find((p) => p.id === "audit_only")!.available).toBe(false);
    expect(await C.subscriptionOf(orgId)).toEqual({ status: "none", planId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
  });

  it("directory and dossier: alphabetical cards, every dossier fact grouped, missing facts show no value", async () => {
    const cards = await C.appCards({ market: "UK", q: "pay" });
    expect(cards.map((c) => c.name)).toEqual([...cards.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
    expect(cards.every((c) => c.name.toLowerCase().includes("pay") || c.categories.some((x) => x.includes("pay")))).toBe(true);
    const d = (await C.dossier("staffology", orgId))!;
    expect(Object.values(d.facts).every((f) => f.group && f.label && (f.state !== "missing" || f.value === null))).toBe(true);
    expect(d.integrations.find((i) => i.toAppId === "deputy")).toMatchObject({ kind: "native" });
  });
});

describe("feedback sub-reasons and undo", () => {
  it("numbers_wrong + one_off (round-2 3b): fine until the financial year ends, the one-off note, no review item", async () => {
    const f = await flagFor("pl:310");
    const before = (await (await adminDb()).select().from(reviewQueue)).length;
    const out = await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "numbers_wrong", subReason: "one_off" });
    expect(out.state).toBe("marked_fine");
    expect(out.message).toMatch(/hidden this line until .* end of this financial year/);
    const line = (await C.lineByFlag(orgId, f.id))!;
    expect(line.oneOffNote).toBeTruthy();
    expect((await (await adminDb()).select().from(reviewQueue)).length).toBe(before);
    const [ov] = await withOrg(orgId, (tx) => tx.select().from(lineOverrides).where(eq(lineOverrides.lineKey, "pl:310")));
    expect(ov).toMatchObject({ state: "marked_fine", until: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    const d = (await C.lineDetail(orgId, "pl:310"))!;
    expect(d.feedback).toMatchObject({ answer: "numbers_wrong", subReason: "one_off" });
  });

  it("undo puts the line back as it was before the answer", async () => {
    const f = await flagFor("pl:310");
    const undone = await undoFeedback({ orgId, flagId: f.id, userId: null });
    expect(undone.state).toBe("flagged");
    expect((await C.lineByFlag(orgId, f.id))!.oneOffNote).toBeNull();
    await expect(undoFeedback({ orgId, flagId: f.id, userId: null })).rejects.toBeInstanceOf(HttpError);
  });

  it("undo of a second answer restores the first answer's effect", async () => {
    const f = await flagFor("pl:310");
    await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "not_now", now: new Date("2026-11-05T00:00:00Z") });
    await submitFeedback({ orgId, flagId: f.id, userId: null, answer: "no_app_needed" });
    expect((await flagFor("pl:310")).state).toBe("marked_fine");
    expect((await undoFeedback({ orgId, flagId: f.id, userId: null })).state).toBe("snoozed");
    // The restored snooze runs 90 days from when that answer was saved.
    const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    expect((await C.lineByFlag(orgId, f.id))!.snoozedUntil).toBe(in90);
    await undoFeedback({ orgId, flagId: f.id, userId: null });
  });
});

describe("shortlist and essentials", () => {
  it("adds, lists (price null, never guessed) and removes", async () => {
    const after = await C.addToShortlist(orgId, null, "marketman", "pl:310");
    expect(after).toEqual([expect.objectContaining({ appId: "marketman", lineKey: "pl:310", price: { value: null, state: "missing" } })]);
    expect((await C.summary(orgId))!.shortlistUnknownPrices).toBe(1);
    expect(await C.removeFromShortlist(orgId, "marketman")).toEqual([]);
    await expect(C.addToShortlist(orgId, null, "no-such-app")).rejects.toBeInstanceOf(HttpError);
  });

  it("essentials follow the business's markets and remember 'covered'", async () => {
    const list = await C.essentialsOf(orgId);
    expect(list.map((e) => e.key)).toContain("uk_vat_returns");
    expect(list.every((e) => e.nextDue === null)).toBe(true);
    const after = await C.setEssential(orgId, "uk_vat_returns", true);
    expect(after.find((e) => e.key === "uk_vat_returns")!.covered).toBe(true);
  });
});

describe("me, waitlist, errors", () => {
  it("me lists only the user's businesses and falls back to the first when the active one isn't theirs", async () => {
    const db = await adminDb();
    const { orgMembers } = await import("@/db/schema");
    const [u] = await db.insert(users).values({ email: "fd@example.test", name: "Fin" }).returning();
    await db.insert(orgMembers).values({ orgId, userId: u!.id, role: "owner" });
    const m = (await C.me(u!.id, "11111111-1111-4111-8111-111111111111"))!;
    expect(m.orgs.map((o) => o.id)).toEqual([orgId]);
    expect(m.activeOrgId).toBe(orgId);
    expect(m.orgs[0]).toMatchObject({ connection: "active", sample: true, industry: "other" });
  });

  it("waitlist: one row per email, a repeat is a silent no-op", async () => {
    const entry = { email: "Lead@Example.test", name: "A", company: "B Ltd", role: "fd", industry: "saas" };
    await joinWaitlist(entry);
    await joinWaitlist({ ...entry, name: "Someone else" });
    const rows = await (await adminDb()).select().from(waitlist);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "lead@example.test", name: "A" });
  });

  it("errors carry code, message, retryable and a requestId (also as a header)", async () => {
    const res = await handle(async () => {
      throw new HttpError(409, "A refresh is already running", undefined, "REFRESH_IN_PROGRESS");
    })();
    const j = (await res.json()) as T.ApiError & { error: string };
    expect(res.status).toBe(409);
    expect(j).toMatchObject({ code: "REFRESH_IN_PROGRESS", message: "A refresh is already running", retryable: true, error: "A refresh is already running" });
    expect(j.requestId).toBe(res.headers.get("x-request-id"));
    const nf = await (await handle(async () => {
      throw new HttpError(404, "Line not found");
    })()).json();
    expect(nf).toMatchObject({ code: "NOT_FOUND", retryable: false });
  });
});
