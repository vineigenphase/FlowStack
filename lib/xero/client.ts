/**
 * Xero Accounting API client (BACKEND.md §3). GET only — this module has no way to send a write.
 * - per-org token bucket (60/min) + 5 concurrent calls
 * - honours Retry-After on 429, retries 5xx with backoff
 * - reads X-DayLimit-Remaining / X-MinLimit-Remaining / X-AppMinLimit-Remaining
 * - meters response bytes (egress is the Xero cost driver)
 * XERO_MODE=fixtures reads /fixtures/xero/<set>/<key>.json instead of calling Xero.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { log } from "@/lib/log";
import { limiter } from "./rate-limit";

export const XERO_API = "https://api.xero.com/api.xro/2.0";

export type XeroCall = {
  /** Logical name, also the fixture file name: organisation, accounts, pl, bs-close, bs-open, tb, invoices, banktransactions. */
  key: string;
  path: string;
  query?: Record<string, string>;
  page?: number;
  ifModifiedSince?: Date;
};

export type XeroResult = { status: number; json: unknown; bytes: number; notModified: boolean };

export type Limits = { day: number | null; minute: number | null; appMinute: number | null };

export interface XeroClient {
  readonly orgKey: string;
  get(call: XeroCall): Promise<XeroResult>;
  readonly meter: { calls: number; bytes: number };
  readonly limits: Limits;
}

export class XeroHttpError extends Error {
  constructor(
    public status: number,
    public endpoint: string,
    detail: string,
  ) {
    super(`Xero ${endpoint} → ${status}: ${detail.slice(0, 200)}`);
  }
}

type LiveOpts = {
  tenantId: string;
  orgKey: string;
  /** Returns a valid access token; `force` asks for a refresh (after a 401). */
  token: (force?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
};

const num = (h: Headers, k: string) => {
  const v = h.get(k);
  return v === null || v === "" ? null : Number(v);
};

export class LiveXeroClient implements XeroClient {
  readonly meter = { calls: 0, bytes: 0 };
  readonly limits: Limits = { day: null, minute: null, appMinute: null };
  readonly orgKey: string;
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;

  constructor(private o: LiveOpts) {
    this.orgKey = o.orgKey;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async get(call: XeroCall): Promise<XeroResult> {
    const url = new URL(XERO_API + call.path);
    for (const [k, v] of Object.entries(call.query ?? {})) url.searchParams.set(k, v);
    if (call.page) url.searchParams.set("page", String(call.page));

    const maxRetries = this.o.maxRetries ?? 3;
    let forced = false;
    for (let attempt = 0; ; attempt++) {
      const res = await limiter.run(this.orgKey, async () => {
        const token = await this.o.token(forced);
        const headers: Record<string, string> = {
          authorization: `Bearer ${token}`,
          "xero-tenant-id": this.o.tenantId,
          accept: "application/json",
        };
        if (call.ifModifiedSince) headers["if-modified-since"] = call.ifModifiedSince.toUTCString();
        return this.fetchImpl(url, { method: "GET", headers });
      });
      this.meter.calls++;
      this.trackLimits(res.headers);

      if (res.status === 304) return { status: 304, json: null, bytes: 0, notModified: true };

      const text = await res.text();
      const bytes = Buffer.byteLength(text);
      this.meter.bytes += bytes;

      if (res.ok) return { status: res.status, json: text ? JSON.parse(text) : null, bytes, notModified: false };

      if (res.status === 401 && !forced) {
        forced = true;
        continue;
      }
      if (attempt < maxRetries && (res.status === 429 || res.status >= 500)) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = res.status === 429 && Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt;
        log.warn({ endpoint: call.key, status: res.status, wait }, "xero retry");
        await this.sleep(wait);
        continue;
      }
      throw new XeroHttpError(res.status, call.key, text);
    }
  }

  private trackLimits(h: Headers) {
    this.limits.day = num(h, "x-daylimit-remaining") ?? this.limits.day;
    this.limits.minute = num(h, "x-minlimit-remaining") ?? this.limits.minute;
    this.limits.appMinute = num(h, "x-appminlimit-remaining") ?? this.limits.appMinute;
    if (this.limits.minute !== null) limiter.observeMinuteRemaining(this.orgKey, this.limits.minute);
  }
}

/** Reads recorded JSON. Paged lists: page 1 → <key>.json or <key>-p1.json, page n → <key>-p<n>.json. */
export class FixtureXeroClient implements XeroClient {
  readonly meter = { calls: 0, bytes: 0 };
  readonly limits: Limits = { day: null, minute: null, appMinute: null };
  readonly orgKey: string;
  readonly dir: string;

  constructor(set: string, orgKey = `fixture:${set}`, root = path.resolve(process.cwd(), "fixtures/xero")) {
    this.dir = path.join(root, set);
    this.orgKey = orgKey;
  }

  async get(call: XeroCall): Promise<XeroResult> {
    const candidates = call.page && call.page > 1 ? [`${call.key}-p${call.page}.json`] : [`${call.key}.json`, `${call.key}-p1.json`];
    for (const name of candidates) {
      try {
        const text = await fs.readFile(path.join(this.dir, name), "utf8");
        const bytes = Buffer.byteLength(text);
        this.meter.calls++;
        this.meter.bytes += bytes;
        return { status: 200, json: JSON.parse(text), bytes, notModified: false };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    this.meter.calls++;
    return { status: 404, json: null, bytes: 0, notModified: false };
  }
}
