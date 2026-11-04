import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FixtureXeroClient, LiveXeroClient, XeroHttpError } from "@/lib/xero/client";
import { bills, getOrganisation } from "@/lib/xero/endpoints";
import { OrgLimiter } from "@/lib/xero/rate-limit";

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers });

const org = { Organisations: [{ Name: "X", BaseCurrency: "GBP", FinancialYearEndDay: 31, FinancialYearEndMonth: 3 }] };
type Init = RequestInit | undefined;
const hdr = (init: Init) => init!.headers as Record<string, string>;

describe("LiveXeroClient", () => {
  it("sends tenant header, meters bytes and tracks limit headers", async () => {
    const fetchImpl = vi.fn(async (_u: unknown, init: Init) => {
      expect(hdr(init)["xero-tenant-id"]).toBe("t1");
      expect(hdr(init).authorization).toBe("Bearer tok");
      expect(init!.method).toBe("GET");
      return res(200, org, { "x-daylimit-remaining": "990", "x-minlimit-remaining": "59", "x-appminlimit-remaining": "9999" });
    });
    const c = new LiveXeroClient({ tenantId: "t1", orgKey: "o1", token: async () => "tok", fetchImpl: fetchImpl as typeof fetch });
    const o = await getOrganisation(c);
    expect(o.Name).toBe("X");
    expect(c.meter.calls).toBe(1);
    expect(c.meter.bytes).toBe(JSON.stringify(org).length);
    expect(c.limits).toEqual({ day: 990, minute: 59, appMinute: 9999 });
  });

  it("honours Retry-After on 429", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const fetchImpl = vi.fn(async () => (n++ === 0 ? res(429, { m: "slow" }, { "retry-after": "7" }) : res(200, org)));
    const c = new LiveXeroClient({ tenantId: "t", orgKey: "o2", token: async () => "tok", fetchImpl: fetchImpl as typeof fetch, sleep });
    await getOrganisation(c);
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(c.meter.calls).toBe(2);
  });

  it("forces one token refresh on 401, then succeeds", async () => {
    const token = vi.fn(async (force?: boolean) => (force ? "new" : "old"));
    const fetchImpl = vi.fn(async (_u: unknown, init: Init) =>
      hdr(init).authorization === "Bearer new" ? res(200, org) : res(401, { e: 1 }),
    );
    const c = new LiveXeroClient({ tenantId: "t", orgKey: "o3", token, fetchImpl: fetchImpl as typeof fetch });
    await getOrganisation(c);
    expect(token).toHaveBeenLastCalledWith(true);
  });

  it("gives up after retries with a typed error", async () => {
    const fetchImpl = vi.fn(async () => res(503, { e: 1 }));
    const c = new LiveXeroClient({
      tenantId: "t",
      orgKey: "o4",
      token: async () => "t",
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async () => {},
      maxRetries: 2,
    });
    await expect(getOrganisation(c)).rejects.toBeInstanceOf(XeroHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("sends If-Modified-Since and stops on 304", async () => {
    const since = new Date("2026-10-01T00:00:00Z");
    const fetchImpl = vi.fn(async (_u: unknown, init: Init) => {
      expect(hdr(init)["if-modified-since"]).toBe(since.toUTCString());
      return new Response(null, { status: 304 });
    });
    const c = new LiveXeroClient({ tenantId: "t", orgKey: "o5", token: async () => "t", fetchImpl: fetchImpl as typeof fetch });
    const pages = [];
    for await (const p of bills(c, new Date("2025-11-01"), since)) pages.push(p);
    expect(pages).toHaveLength(0);
  });
});

describe("FixtureXeroClient", () => {
  it("reads the synthetic set and returns 404 past the last page", async () => {
    const c = new FixtureXeroClient("demo-uk-synthetic");
    const o = await getOrganisation(c);
    expect(o.Name).toContain("(sample)");
    const got = await c.get({ key: "invoices", path: "/Invoices", page: 2 });
    expect(got.status).toBe(404);
  });
});

describe("OrgLimiter", () => {
  it("never runs more than 5 calls at once per org", async () => {
    const l = new OrgLimiter(1000, 5);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        l.run("o", async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(5);
  });

  it("waits when the minute bucket is empty", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const l = new OrgLimiter(60, 5, () => t, async (ms) => {
      sleeps.push(ms);
      t += ms;
    });
    for (let i = 0; i < 61; i++) await l.run("o", async () => {});
    expect(sleeps).toEqual([1000]);
  });
});

describe("guardrail: read-only", () => {
  it("no file in lib/xero that talks to api.xro uses a write method", () => {
    const dir = path.resolve("lib/xero");
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      if (/api\.xro|XERO_API/.test(src)) expect(src, f).not.toMatch(/\b(PUT|POST|PATCH|DELETE)\b/);
    }
  });
});
