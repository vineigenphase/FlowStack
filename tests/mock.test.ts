/** UI-SPEC §3 mock mode: every scenario reachable; mocks keep the live contract's fields (regenerate with pnpm mocks). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { orgs } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import * as C from "@/lib/api/contract";
import { mockResponse, SCENARIOS } from "@/lib/api/mock";
import type * as T from "@/lib/api/types";

const index = mockResponse; // shorthand below
const get = <R>(path: string, scenario = "default") => {
  const [p, q] = path.split("?");
  const qs = new URLSearchParams(q ?? "");
  qs.set("scenario", scenario);
  const r = index("GET", p!.split("/").filter(Boolean), qs, null);
  return r as { status: number; json: R };
};
const ORG = "00000000-0000-4000-8000-00000000a001";

describe("scenarios", () => {
  it("default: a labelled sample business with flags, trends and a shortlist", () => {
    const s = get<T.Summary>(`/orgs/${ORG}/summary`).json;
    expect(s.sample).toBe(true);
    expect(s.banners.map((b) => b.kind)).toEqual(["sample"]);
    expect(s.flaggedLines).toBeGreaterThan(0);
    expect(s.trends.some((t) => t.flagged)).toBe(true);
    expect(get<T.ShortlistItem[]>(`/orgs/${ORG}/shortlist`).json.length).toBe(2);
    expect(get<T.Me>("/me").json.orgs).toHaveLength(1);
  });
  it("each scenario shows its state", () => {
    expect(get<T.Summary>(`/orgs/${ORG}/summary`, "empty").json).toMatchObject({ flaggedLines: 0, biggestLines: [] });
    expect(get<T.Statement>(`/orgs/${ORG}/statements/pl`, "empty").json.sections.flatMap((s) => s.lines).some((l) => l.state === "flagged")).toBe(false);
    expect(get<T.Summary>(`/orgs/${ORG}/summary`, "refreshing").json.refreshing).toBe(true);
    expect(get<T.RefreshRun>(`/orgs/${ORG}/refresh/x`, "refreshing").json.status).toBe("running");
    expect(get<T.Summary>(`/orgs/${ORG}/summary`, "refresh_failed").json.banners.map((b) => b.kind)).toContain("refresh_failed");
    expect(get<T.RefreshRun>(`/orgs/${ORG}/refresh/x`, "refresh_failed").json.error?.retryable).toBe(true);
    const cf = get<T.Statement>(`/orgs/${ORG}/statements/cf`, "unreconciled").json;
    expect(cf).toMatchObject({ reconciled: false, reconDiff: 1234.56 });
    expect(cf.sections.flatMap((s) => s.lines).some((l) => l.state === "flagged")).toBe(false);
    expect(get<T.Me>("/me", "revoked").json.orgs[0]!.connection).toBe("revoked");
    expect(get<T.Summary>(`/orgs/${ORG}/summary`, "revoked").json.banners.map((b) => b.kind)).toContain("connection_revoked");
    expect(get<T.Summary>(`/orgs/${ORG}/summary`, "lapsing").json.questions[0]?.kind).toBe("lapsing");
    expect(get<{ apps: T.DetectedApp[] }>(`/orgs/${ORG}/detected-apps`, "lapsing").json.apps.some((a) => a.state === "lapsing")).toBe(true);
    expect(get<T.Subscription>(`/orgs/${ORG}/subscription`, "past_due").json.status).toBe("past_due");
    expect(get<T.Summary>(`/orgs/${ORG}/summary`, "past_due").json.banners.map((b) => b.kind)).toContain("payment_failed");
    expect(get<T.Me>("/me", "accountant").json.orgs).toHaveLength(5);
    expect(SCENARIOS).toHaveLength(9);
  });
  it("writes answer like the API; unknown paths are a 404 ApiError", () => {
    const line = get<T.Summary>(`/orgs/${ORG}/summary`).json.biggestLines[0]!;
    const post = (b: unknown) => index("POST", ["flags", line.flagId!, "feedback"], new URLSearchParams(), b);
    expect(post({ answer: "numbers_wrong" }).status).toBe(400);
    const r = post({ answer: "numbers_wrong", subReason: "one_off" }).json as T.FeedbackResult;
    expect(r.line).toMatchObject({ state: "queued", oneOffNote: expect.any(String) });
    expect((post({ answer: "not_now" }).json as T.FeedbackResult).line.snoozedUntil).toBeTruthy();
    const nf = get<T.ApiError>("/nothing/here");
    expect(nf.status).toBe(404);
    expect(nf.json).toMatchObject({ code: "NOT_FOUND", requestId: "mock" });
    expect(get(`/orgs/${ORG}/lines/${encodeURIComponent(line.key)}`).status).toBe(200);
  });
});

describe("mocks are fresh", () => {
  let close: () => Promise<void>;
  let orgId: string;
  beforeAll(async () => {
    close = (await freshDb()).close;
    orgId = (await (await adminDb()).insert(orgs).values({ name: "Northwind Goods Ltd (sample)", sample: true, industry: "ecommerce" }).returning())[0]!.id;
    await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-ecommerce", orgId), now: new Date("2026-11-04T10:00:00Z") });
  });
  afterAll(() => close());

  const shape = (v: unknown): unknown =>
    Array.isArray(v) ? (v.length ? [shape(v[0])] : []) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])])) : typeof v;
  const keys = (v: object) => Object.keys(v).sort();

  it("summary, statement and line detail have the live contract's fields (run pnpm mocks if this fails)", async () => {
    const live = (await C.summary(orgId))!;
    const mock = get<T.Summary>(`/orgs/${ORG}/summary`).json;
    expect(keys(mock)).toEqual(keys(live));
    expect(keys(mock.biggestLines[0]!)).toEqual(keys(live.biggestLines[0]!));
    expect(shape(mock.trends[0])).toEqual(shape(live.trends[0]));
    const ls = (await C.statement(orgId, "bs", { months: 12 }))!;
    const ms = get<T.Statement>(`/orgs/${ORG}/statements/bs?months=12`).json;
    expect(keys(ms)).toEqual(keys(ls));
    const lk = live.biggestLines[0]!.key;
    const ld = (await C.lineDetail(orgId, lk))!;
    const md = get<T.LineDetail>(`/orgs/${ORG}/lines/${encodeURIComponent(lk)}`).json;
    expect(keys(md)).toEqual(keys(ld));
    expect(keys(md.evidence)).toEqual(keys(ld.evidence));
    expect(shape(md.recommendations[0])).toEqual(shape(ld.recommendations[0]));
  });
});
