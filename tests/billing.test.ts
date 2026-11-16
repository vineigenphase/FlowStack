/** v1.1 E: Stripe billing in test mode. No network: Checkout params are pure; webhooks use Stripe's signing. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { orgs, paymentsLog, subscriptions } from "@/db/schema";
import { resetEnv } from "@/lib/env";
import { billingStatus, checkoutParams, handleWebhook, plans } from "@/lib/billing";

const ids = { pro_monthly: "price_m", pro_annual: "price_a", audit: "price_audit", audit_waived: "coupon_w" };
const params = (plan: string, waiveAudit = false, i: Record<string, string> = ids) => checkoutParams({ owner: { orgId: ORG }, plan, waiveAudit, appUrl: "https://x.test", ids: i, catalog: plans() });
const ORG = "11111111-1111-4111-8111-111111111111";

describe("plans and checkout (pure)", () => {
  it("plans come from catalog/plans.yaml with no prices decided yet", () => {
    const p = plans();
    expect(p.plans.map((x) => x.key)).toEqual(["pro_monthly", "pro_annual"]);
    expect(p.plans.every((x) => x.price_gbp === null)).toBe(true);
  });
  it("round-2 3e: monthly always carries the one-off audit (waivable by coupon); metadata ties it to the org", () => {
    const c = params("pro_monthly", true);
    expect(c.mode).toBe("subscription");
    expect(c.line_items).toEqual([{ price: "price_m", quantity: 1 }, { price: "price_audit", quantity: 1 }]);
    expect(c.discounts).toEqual([{ coupon: "coupon_w" }]);
    expect(c.metadata).toEqual({ org_id: ORG, plan: "pro_monthly" });
    expect(c.success_url).toBe(`https://x.test/app/${ORG}/billing?billing=done`);
    expect(params("pro_monthly").line_items).toHaveLength(2);
    expect(params("pro_monthly").discounts).toBeUndefined();
    expect(() => checkoutParams({ owner: { orgId: ORG }, plan: "gold", audit: false, waiveAudit: false, appUrl: "", ids, catalog: plans() })).toThrow(/Unknown plan/);
    expect(() => checkoutParams({ owner: { orgId: ORG }, plan: "pro_annual", audit: false, waiveAudit: false, appUrl: "", ids: {}, catalog: plans() })).toThrow(/No Stripe price/);
  });
  it("round-2 3e: annual includes the audit (no audit line); audit only is a one-off payment", () => {
    const a = params("pro_annual", true);
    expect(a.line_items).toEqual([{ price: "price_a", quantity: 1 }]);
    expect(a.discounts).toBeUndefined();
    const o = params("audit");
    expect(o.mode).toBe("payment");
    expect(o.line_items).toEqual([{ price: "price_audit", quantity: 1 }]);
    expect(o.subscription_data).toBeUndefined();
    expect(o.metadata).toEqual({ org_id: ORG, plan: "audit" });
    expect(() => params("audit", false, {})).toThrow(/No Stripe price/);
  });
  it("plans.yaml: prices null, design_partner coupon listed, audit sold alone", () => {
    const p = plans();
    expect(p.plans.map((x) => [x.key, x.audit])).toEqual([["pro_monthly", "extra"], ["pro_annual", "included"]]);
    expect([...p.plans, ...p.one_off].every((x) => x.price_gbp === null)).toBe(true);
    expect(p.coupons.map((c) => c.key)).toEqual(["audit_waived", "design_partner"]);
    expect(p.one_off.find((o) => o.key === "audit")!.sold_alone).toBe(true);
  });
  it("test keys only while prices are open", () => {
    const set = (k: string) => {
      process.env.STRIPE_SECRET_KEY = k;
      resetEnv();
      return billingStatus().enabled;
    };
    expect(set("")).toBe(false);
    expect(set("sk_live_abc")).toBe(false);
    expect(set("sk_test_abc")).toBe(true);
    delete process.env.STRIPE_SECRET_KEY;
    resetEnv();
  });
});

describe("webhook", () => {
  let close: () => Promise<void>;
  const secret = "whsec_test";
  const stripe = new Stripe("sk_test_dummy");
  const send = (event: Record<string, unknown>) => {
    const payload = JSON.stringify(event);
    return handleWebhook(payload, stripe.webhooks.generateTestHeaderString({ payload, secret }), { stripe, secret });
  };
  beforeAll(async () => {
    const h = await freshDb();
    close = h.close;
    await (await adminDb()).insert(orgs).values({ id: ORG, name: "Paying Ltd" });
  });
  afterAll(() => close());

  it("rejects a bad signature", async () => {
    await expect(handleWebhook("{}", "t=1,v1=bad", { stripe, secret })).rejects.toMatchObject({ status: 400 });
  });
  it("checkout completed → subscription; updated, payment failed, deleted → status; each event once", async () => {
    const completed = { id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_1", object: "checkout.session", subscription: "sub_1", customer: "cus_1", metadata: { org_id: ORG, plan: "pro_monthly" } } } };
    await send(completed);
    expect(await send(completed)).toEqual({ received: true, duplicate: true });
    const db = await adminDb();
    const sub = async () => (await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, "sub_1")))[0]!;
    expect(await sub()).toMatchObject({ orgId: ORG, stripeCustomerId: "cus_1", plan: "pro_monthly", status: "active" });

    await send({ id: "evt_2", object: "event", type: "customer.subscription.updated", data: { object: { id: "sub_1", object: "subscription", status: "active", items: { data: [{ current_period_end: 1798761600 }] } } } });
    expect((await sub()).currentPeriodEnd?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    await send({ id: "evt_3", object: "event", type: "invoice.payment_failed", data: { object: { id: "in_1", object: "invoice", subscription: "sub_1" } } });
    expect((await sub()).status).toBe("past_due");
    await send({ id: "evt_4", object: "event", type: "customer.subscription.deleted", data: { object: { id: "sub_1", object: "subscription", status: "canceled", items: { data: [] } } } });
    expect((await sub()).status).toBe("canceled");

    const log = await db.select().from(paymentsLog);
    expect(log).toHaveLength(4);
    // Ids and statuses only.
    expect(JSON.stringify(log.map((l) => l.payloadSummary))).not.toMatch(/card|address|email/i);
  });
});
