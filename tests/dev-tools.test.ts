/**
 * ENGINE-V2 Phase 2: dev tools. The panel's what-if re-ranking must match the server's formula; the queue summary
 * and "needs a person" read the right rows; the gate is off unless DEV_TOOLS and admin; the pulse respects
 * reduced motion and never flashes faster than 3 times a second.
 */
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rulesFile } from "@/lib/catalog/load";
import { v2Apps } from "@/lib/rank/v2/apps";
import { rankLine } from "@/lib/rank/v2/score";
import { flatWeights } from "@/lib/rank/v2/trace";
import { rematch } from "@/components/dev/dev-tools";

const S = rulesFile().scoring_v2!;
const rule = rulesFile().rules.find((r) => r.id === "receivables")!;
const res = rankLine(
  { lineKey: "bs:610", name: "Trade debtors", value: 1, materiality: 0.1, band: "high", ruleId: rule.id, ruleVersion: 1, state: "flagged", strengthNorm: 0.7 },
  rule,
  { pool: v2Apps(), kept: [], inUse: new Set(), markets: ["UK"], industry: "professional_services", annualRevenue: 1_200_000, headcount: null, year: 2026, scoring: S },
);

describe("Engine panel what-if", () => {
  it("re-ranking in the browser with the YAML weights gives exactly the server's match for every candidate", () => {
    const w = flatWeights(S);
    for (const c of res.candidates) expect(Math.abs(rematch(c.parts, w) - c.match), c.name).toBeLessThanOrEqual(0.01);
  });

  it("other weights change the order (price-heavy favours apps with a cheap published price)", () => {
    const w = { ...flatWeights(S), strength: 0.1, fit: 0.1, quality: 0.1, price: 0.7 };
    const top = [...res.candidates].sort((a, b) => rematch(b.parts, w) - rematch(a.parts, w))[0]!;
    expect(top.parts.find((p) => p.key === "price")!.missing).toBe(false);
  });
});

describe("pulse and reduced motion (globals.css)", () => {
  const css = fs.readFileSync("app/globals.css", "utf8");
  it("the review box pulses on a 1.6 s cycle (amber normal, red high) and stops under prefers-reduced-motion", () => {
    expect(css).toMatch(/\.dev-review-box\.pulse \{[^}]*animation: dev-glow-amber 1\.6s/);
    expect(css).toMatch(/\.dev-review-box\.pulse-high \{[^}]*animation: dev-glow-red 1\.6s/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.dev-review-box\.pulse, \.dev-review-box\.pulse-high \{ animation: none; \}/);
    for (const m of css.matchAll(/dev-glow-\w+ ([\d.]+)s/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1 / 3);
  });
  it("the glass has a solid fallback where backdrop-filter isn't supported", () => {
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\)[^{]*\{ \.dev-panel, \.dev-pill \{ background: var\(--glass-solid\); \} \}/);
  });
});

describe("queue summary and 'needs a person' (throwaway db)", () => {
  let close: () => Promise<void>;
  let orgId: string;
  beforeAll(async () => {
    const { freshDb } = await import("./helpers/db");
    const { adminDb } = await import("@/lib/db/client");
    const { orgs, reviewQueue } = await import("@/db/schema");
    close = (await freshDb()).close;
    const db = await adminDb();
    const [o] = await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true }).returning();
    orgId = o!.id;
    const t = (h: number) => new Date(Date.UTC(2026, 10, 20, h));
    await db.insert(reviewQueue).values([
      { kind: "flag_disputed", orgId, ref: { org_id: orgId, line_key: "bs:610", rule_id: "receivables" }, refHash: "a", reason: "x", createdAt: t(1) },
      { kind: "account_mapping", orgId, ref: { org_id: orgId, xero_account_id: "acc-1" }, refHash: "b", reason: "x", priority: "high", createdAt: t(2) },
      { kind: "catalog_gap", orgId: null, ref: { rule_id: "x" }, refHash: "c", reason: "x", createdAt: t(3) },
      { kind: "flag_disputed", orgId, ref: { org_id: orgId, line_key: "pl:999", rule_id: "x" }, refHash: "d", reason: "x", status: "done", createdAt: t(0) },
    ]);
  });
  afterAll(() => close?.());

  it("counts open items by kind and priority; the oldest come first; closed items don't count", async () => {
    const { queueSummary } = await import("@/lib/dev/tools");
    const s = await queueSummary();
    expect(s.total).toBe(3);
    expect(s.high).toBe(1);
    expect(s.oldest.map((o) => o.kind)).toEqual(["flag_disputed", "account_mapping", "catalog_gap"]);
    expect(s.oldest[0]!.org).toBe("Copperpot (sample)");
    expect((await queueSummary(orgId)).total).toBe(2);
  });

  it("needs a person: disputed lines by line key, mapping items by Xero account; done items ignored", async () => {
    const { needsPerson } = await import("@/lib/dev/tools");
    expect(await needsPerson(orgId)).toEqual({ lineKeys: ["bs:610"], accountIds: ["acc-1"] });
  });

  it("dev tools stay off when DEV_TOOLS is false, signed in or not", async () => {
    const { resetEnv } = await import("@/lib/env");
    const { devToolsOn } = await import("@/lib/dev/tools");
    const prev = process.env.DEV_TOOLS;
    process.env.DEV_TOOLS = "false";
    resetEnv();
    expect(await devToolsOn()).toBe(false);
    process.env.DEV_TOOLS = prev;
    resetEnv();
  });
});

describe("dev links", () => {
  it("every link is a site path; business links cover the pages, debug, digest and each line's v1 + v2 trace", async () => {
    const { generalLinks, orgLinks } = await import("@/lib/dev/links");
    const all = [...generalLinks(), ...orgLinks("00000000-0000-0000-0000-000000000000", [{ lineKey: "pl:310", name: "Cost of Goods Sold", value: 1, state: "flagged", ruleId: "x" }])].flatMap((g) => g.links);
    for (const l of all) expect(l.path.startsWith("/") && !l.path.startsWith("//"), l.path).toBe(true);
    const paths = all.map((l) => l.path);
    expect(paths).toContain("/admin/debug/00000000-0000-0000-0000-000000000000");
    expect(paths).toContain("/api/dev/engine/00000000-0000-0000-0000-000000000000/pl%3A310?engine=v2");
    expect(paths).toContain("/api/dev/engine/00000000-0000-0000-0000-000000000000/pl%3A310?engine=v1");
    expect(paths).toContain("/admin/queue#catalog_gap");
  });

  it("the review queue page shows the links only after the admin check", async () => {
    const src = (await import("node:fs")).readFileSync("app/admin/queue/page.tsx", "utf8");
    const denied = src.indexOf("This page is for the FlowStack team.");
    expect(src.indexOf("<DevLinks")).toBeGreaterThan(denied);
  });
});
