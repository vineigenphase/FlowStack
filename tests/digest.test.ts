/** Round-2 3d (NEXT-STEPS P2.13): monthly digest, template only, previewed not sent. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { auditLog, orgs } from "@/db/schema";
import { composeDigest, digestBlocks, renderDigest, sendOn, type DigestData } from "@/lib/digest";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { saveSettings } from "@/lib/orgs/settings";
import { settingsOf } from "@/lib/api/contract";
import type { Summary } from "@/lib/api/types";

const S = (over: Partial<Summary> = {}): Summary =>
  ({
    period: { label: "Apr–Oct 2026", from: "2026-04-01", to: "2026-10-31" },
    atStake: 12_345,
    atStakeLabel: "At stake",
    flaggedLines: 2,
    totalLines: 30,
    appsInUse: 3,
    appsMatched: 2,
    shortlistMonthly: null,
    shortlistUnknownPrices: 0,
    biggestLines: [
      { key: "pl:477", code: "477", name: "Wages <and> Salaries", value: 9000 },
      { key: "pl:420", code: "420", name: "Entertainment", value: 3345 },
    ],
    trends: [],
    questions: [{ id: "q1", kind: "lapsing", appId: "dext", appName: "Dext", lastPaid: "2026-08-03" }],
    banners: [{ kind: "sample", message: "Sample data" }],
    lastRefreshAt: "2026-11-01T10:00:00Z",
    refreshing: false,
    sample: false,
    ...over,
  }) as Summary;
const D = (s: Summary | null): DigestData => ({ orgId: "o1", orgName: "Acme & Co", appUrl: "https://app.test", sample: false, summary: s });

describe("digest (pure)", () => {
  it("lede, biggest lines with links, app questions; the sample banner isn't an action", () => {
    const { lede, blocks } = digestBlocks(D(S()));
    expect(lede).toBe("£12,345 at stake across 2 lines (Apr–Oct 2026).");
    expect(blocks.map((b) => b.heading)).toEqual(["Biggest flagged lines", "Questions about your apps"]);
    expect(blocks[0]!.items[0]).toEqual({ text: "Wages <and> Salaries: £9,000", href: "https://app.test/app/o1/lines/pl%3A477" });
    expect(blocks[1]!.items[0]!.text).toBe("Still using Dext? The last payment we saw was on 3 August 2026.");
  });
  it("HTML escapes names; text and HTML carry the off switch; no refresh yet → a nudge only", () => {
    const d = renderDigest(D(S()));
    expect(d.subject).toBe("Acme & Co: your month in FlowStack");
    expect(d.html).toContain("Acme &amp; Co");
    expect(d.html).toContain("Wages &lt;and&gt; Salaries");
    expect(d.html).not.toContain("<and>");
    expect(d.text).toContain("Turn these emails off: https://app.test/app/o1/settings");
    expect(digestBlocks(D(null)).blocks).toEqual([]);
    expect(digestBlocks(D(S({ lastRefreshAt: null }))).lede).toMatch(/haven't read your books/);
  });
  it("sent 7 days before the billing date; no billing date → never", () => {
    expect(sendOn("2026-12-03")).toBe("2026-11-26");
    expect(sendOn(null)).toBeNull();
  });
});

describe("digest (composed from a refreshed sample business)", () => {
  let close: () => Promise<void>;
  let orgId: string;
  beforeAll(async () => {
    close = (await freshDb()).close;
    orgId = (await (await adminDb()).insert(orgs).values({ name: "Digest Ltd (sample)", sample: true }).returning())[0]!.id;
    await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
  });
  afterAll(() => close());

  it("composes, labels sample data, is off until opted in, and is never sent", async () => {
    const d = (await composeDigest(orgId))!;
    expect(d.subject).toContain("(sample data)");
    expect(d.optedIn).toBe(false);
    expect(d.sending).toBe(false);
    expect(d.sendOn).toBeNull(); // no subscription
    expect(d.html).toContain("Open FlowStack");
  });

  it("the opt-in is stored, shown in settings and audited", async () => {
    await saveSettings(orgId, "user-1", { digestOptIn: true });
    expect((await settingsOf(orgId))!.digestOptIn).toBe(true);
    expect((await composeDigest(orgId))!.optedIn).toBe(true);
    const rows = await (await adminDb()).select().from(auditLog).where(eq(auditLog.action, "digest.on"));
    expect(rows).toHaveLength(1);
  });
});
