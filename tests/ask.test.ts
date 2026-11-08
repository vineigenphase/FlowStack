/** CLAUDE.md §7.4 Ask + §2.2 / BACKEND D9: keyword retrieval, rules answer without consent, no amounts in prompts. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { orgs, statementLines, supplierSpend } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { apps } from "@/lib/catalog/load";
import { ask, askPrompt, features, retrieve } from "@/lib/llm/ask";

describe("retrieve (pure)", () => {
  const ctx = { markets: ["UK"], inUse: ["deputy", "lightspeed"], needsLook: ["payroll"], catalog: apps() };

  it("maps plain words to finance jobs and prefers apps that work with what they keep", () => {
    const r = retrieve("We need a payroll app that handles tronc", ctx);
    expect(r.jobs[0]).toBe("payroll");
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.app.categories.includes("payroll"))).toBe(true);
    const top = r.candidates[0]!;
    expect(top.reasons.join(" ")).toContain("payroll needs a look");
    expect(top.sources).toContain("signal:payroll");
  });

  it("a named app with no job words looks in that app's jobs", () => {
    const r = retrieve("alternatives to Dext?", ctx);
    expect(r.named).toContain("dext");
    expect(r.jobs).toContain("data_capture");
  });

  it("nothing matches → no candidates (never a generic list)", () => {
    expect(retrieve("what's the weather like", ctx).candidates).toEqual([]);
  });
});

describe("ask (db)", () => {
  let close: () => Promise<void>;
  let orgId: string;

  beforeAll(async () => {
    const h = await freshDb();
    close = h.close;
    const db = await adminDb();
    orgId = (await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true, industry: "hospitality" }).returning())[0]!.id;
    await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
  });
  afterAll(() => close());

  it("features are derived only: labels, app ids and job keys, no numbers", async () => {
    const f = await features(orgId);
    expect(f.industry).toBe("Hospitality");
    expect(f.sizeBand).toBe("£1m–£5m revenue");
    expect(f.needsLook).toContain("payroll");
    expect(f.askAi).toBe(false);
  });

  it("the prompt carries no ledger amounts, contact names or account names", async () => {
    const f = await features(orgId);
    const r = retrieve("payroll for a restaurant", { markets: f.markets, inUse: f.inUse, needsLook: f.needsLook, catalog: apps() });
    const { prompt, allowed } = askPrompt("payroll for a restaurant", f, r, () => null, () => null);
    // No ledger figure appears in any common format (the size band is a band label, by design).
    const values = await withOrg(orgId, (tx) => tx.select({ v: statementLines.value }).from(statementLines));
    for (const { v } of values.filter((x) => Math.abs(x.v) >= 1000)) {
      const n = Math.abs(Math.round(v));
      for (const s of [String(n), n.toLocaleString("en-GB"), `${Math.round(n / 1000)}k`]) expect(prompt, s).not.toContain(s);
    }
    expect(prompt.replace(/£1m–£5m revenue/, "")).not.toContain("£");
    expect(prompt).not.toContain("Wages and Salaries");
    const contacts = await withOrg(orgId, (tx) => tx.selectDistinct({ name: supplierSpend.contactName }).from(supplierSpend));
    // Suppliers that are themselves catalogue apps appear by the catalogue name (e.g. Deputy); any other supplier must not.
    const appNames = new Set(apps().flatMap((a) => [a.name.toLowerCase(), a.id]));
    const others = contacts.filter((c) => ![...appNames].some((n) => c.name.toLowerCase().includes(n)));
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) expect(prompt.toLowerCase()).not.toContain(c.name.toLowerCase());
    expect(allowed.has("signal:payroll")).toBe(true);
  });

  it("without consent (or with the LLM off) it answers with rules only and says why", async () => {
    const r = await ask(orgId, "which payroll app works with Deputy?");
    expect(r.mode).toBe("rules");
    expect(r.answer).toBeNull();
    expect(r.why).toBeTruthy();
    expect(r.candidates[0]!.reasons.join(" ")).toMatch(/Deputy|payroll/);
    const db = await adminDb();
    await db.update(orgs).set({ askAi: true }).where(eq(orgs.id, orgId));
    // LLM_ENABLED is false in tests, so still rules.
    expect((await ask(orgId, "payroll")).mode).toBe("rules");
  });
});
