/**
 * Billing on Stripe (BACKEND.md §20, v1.1 E: provider DECIDED, prices OPEN).
 * Checkout for sign-up, Billing for subscriptions, the Customer Portal for card changes and cancellation.
 * Plans and prices: catalog/plans.yaml + STRIPE_PRICE_IDS_JSON; never in code.
 *
 * TODO(CHANGES-v1.1.md §4 item 1): until prices are decided only Stripe TEST keys are accepted.
 * We never see or store card details: Stripe hosts the payment pages. The webhook log keeps ids and statuses only.
 */
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { parse } from "yaml";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { paymentsLog, subscriptions } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/api";

const PlansFile = z.object({
  plans: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      interval: z.enum(["month", "year"]),
      /** Round-2 3e: extra = the one-off audit is added at checkout; included = the plan already covers it. */
      audit: z.enum(["extra", "included"]).default("extra"),
      price_gbp: z.number().nullable(),
      stripe_price: z.string(),
    }),
  ),
  one_off: z.array(z.object({ key: z.string(), label: z.string(), price_gbp: z.number().nullable(), stripe_price: z.string(), sold_alone: z.boolean().default(false) })).default([]),
  coupons: z.array(z.object({ key: z.string(), label: z.string(), stripe_coupon: z.string() })).default([]),
});
export type Plans = z.infer<typeof PlansFile>;

export function plans(): Plans {
  return PlansFile.parse(parse(fs.readFileSync(path.join(process.cwd(), "catalog", "plans.yaml"), "utf8")));
}

function priceIds(): Record<string, string> {
  const raw = env().STRIPE_PRICE_IDS_JSON;
  if (!raw) return {};
  try {
    return z.record(z.string(), z.string()).parse(JSON.parse(raw));
  } catch {
    throw new HttpError(503, "STRIPE_PRICE_IDS_JSON isn't valid JSON");
  }
}

/** Billing is on when a test-mode key is set. Live keys are refused while prices are OPEN. */
export function billingStatus(): { enabled: boolean; reason: string | null } {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) return { enabled: false, reason: "Billing isn't switched on yet." };
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) return { enabled: false, reason: "Billing runs in Stripe test mode only until prices are decided." };
  return { enabled: true, reason: null };
}

let client: Stripe | null = null;
function stripe(): Stripe {
  const s = billingStatus();
  if (!s.enabled) throw new HttpError(503, s.reason!);
  client ??= new Stripe(env().STRIPE_SECRET_KEY);
  return client;
}

export type Owner = { orgId: string; firmId?: undefined } | { firmId: string; orgId?: undefined };

/** Billing page path for an owner; Stripe sends people back here. */
const backPath = (o: Owner) => (o.orgId ? `/app/${o.orgId}/billing` : `/practice/${o.firmId}`);

/**
 * Pure: the Checkout Session parameters (tested without calling Stripe). Round-2 3e:
 * - a plan with `audit: extra` (monthly) always carries the one-off audit line; `waiveAudit` applies audit_waived
 * - a plan with `audit: included` (annual) has no audit line
 * - plan "audit" (a one-off with sold_alone) is a one-off payment, no subscription
 * `audit` is kept for older callers; it no longer changes anything.
 */
export function checkoutParams(i: { owner: Owner; plan: string; audit?: boolean; waiveAudit: boolean; email?: string; appUrl: string; ids: Record<string, string>; catalog: Plans }): Stripe.Checkout.SessionCreateParams {
  const ownerMeta: Record<string, string> = i.owner.orgId ? { org_id: i.owner.orgId } : { firm_id: i.owner.firmId! };
  const back = backPath(i.owner);
  const alone = i.catalog.one_off.find((o) => o.key === i.plan && o.sold_alone);
  if (alone) {
    const price = i.ids[alone.stripe_price];
    if (!price) throw new HttpError(503, `No Stripe price set for ${alone.key} (STRIPE_PRICE_IDS_JSON)`);
    return {
      mode: "payment",
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: false,
      customer_email: i.email || undefined,
      client_reference_id: i.owner.orgId ?? i.owner.firmId,
      metadata: { ...ownerMeta, plan: alone.key },
      payment_intent_data: { metadata: { ...ownerMeta, plan: alone.key } },
      success_url: `${i.appUrl}${back}?billing=done`,
      cancel_url: `${i.appUrl}${back}?billing=cancelled`,
    };
  }
  const plan = i.catalog.plans.find((p) => p.key === i.plan);
  if (!plan) throw new HttpError(422, `Unknown plan ${i.plan}`);
  const price = i.ids[plan.stripe_price];
  if (!price) throw new HttpError(503, `No Stripe price set for ${plan.key} (STRIPE_PRICE_IDS_JSON)`);
  const lineItems: { price: string; quantity: number }[] = [{ price, quantity: 1 }];
  let discounts: { coupon: string }[] | undefined;
  if (plan.audit === "extra") {
    const audit = i.catalog.one_off.find((o) => o.key === "audit");
    const auditPrice = audit ? i.ids[audit.stripe_price] : undefined;
    if (!auditPrice) throw new HttpError(503, "No Stripe price set for the audit (STRIPE_PRICE_IDS_JSON)");
    lineItems.push({ price: auditPrice, quantity: 1 });
    if (i.waiveAudit) {
      const c = i.catalog.coupons.find((x) => x.key === "audit_waived");
      const coupon = c ? i.ids[c.stripe_coupon] : undefined;
      if (!coupon) throw new HttpError(503, "No Stripe coupon set for audit_waived (STRIPE_PRICE_IDS_JSON)");
      discounts = [{ coupon }];
    }
  }
  return {
    mode: "subscription",
    line_items: lineItems,
    ...(discounts ? { discounts } : { allow_promotion_codes: false }),
    customer_email: i.email || undefined,
    client_reference_id: i.owner.orgId ?? i.owner.firmId,
    metadata: { ...ownerMeta, plan: plan.key },
    subscription_data: { metadata: { ...ownerMeta, plan: plan.key } },
    success_url: `${i.appUrl}${back}?billing=done`,
    cancel_url: `${i.appUrl}${back}?billing=cancelled`,
  };
}

export async function createCheckout(i: { owner: Owner; plan: string; audit?: boolean; waiveAudit?: boolean; email?: string }) {
  const s = stripe();
  const params = checkoutParams({ ...i, waiveAudit: Boolean(i.waiveAudit), appUrl: env().APP_URL, ids: priceIds(), catalog: plans() });
  const session = await s.checkout.sessions.create(params);
  return { url: session.url };
}

export async function subscriptionFor(owner: Owner) {
  const db = await adminDb();
  const where = owner.orgId ? eq(subscriptions.orgId, owner.orgId) : eq(subscriptions.firmId, owner.firmId!);
  const [row] = await db.select().from(subscriptions).where(where).limit(1);
  return row ?? null;
}

export async function createPortal(owner: Owner) {
  const sub = await subscriptionFor(owner);
  if (!sub) throw new HttpError(404, "No subscription yet");
  const back = backPath(owner);
  const session = await stripe().billingPortal.sessions.create({ customer: sub.stripeCustomerId, return_url: `${env().APP_URL}${back}` });
  return { url: session.url };
}

const periodEnd = (sub: Stripe.Subscription): Date | null => {
  // Newer API versions put the period on each item; older ones on the subscription.
  const t = (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof t === "number" ? new Date(t * 1000) : null;
};

/**
 * POST /api/stripe/webhook. Verifies the signature, records each event once (payments_log), and keeps
 * `subscriptions` in step. Handles checkout.session.completed, customer.subscription.updated|deleted,
 * invoice.payment_failed; others are logged and ignored.
 */
export async function handleWebhook(rawBody: string, signature: string | null, deps: { stripe?: Stripe; secret?: string } = {}) {
  const secret = deps.secret ?? env().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, "STRIPE_WEBHOOK_SECRET not set");
  if (!signature) throw new HttpError(400, "Missing Stripe signature");
  const s = deps.stripe ?? stripe();
  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new HttpError(400, "Bad Stripe signature");
  }
  const db = await adminDb();
  const [seen] = await db.select({ id: paymentsLog.id }).from(paymentsLog).where(eq(paymentsLog.stripeEventId, event.id));
  if (seen) return { received: true, duplicate: true };

  const summary: Record<string, unknown> = { type: event.type };
  switch (event.type) {
    case "checkout.session.completed": {
      const cs = event.data.object;
      const meta = cs.metadata ?? {};
      const subId = typeof cs.subscription === "string" ? cs.subscription : cs.subscription?.id;
      const customer = typeof cs.customer === "string" ? cs.customer : cs.customer?.id;
      if (subId && customer && (meta.org_id || meta.firm_id)) {
        const row = { orgId: meta.org_id ?? null, firmId: meta.firm_id ?? null, stripeCustomerId: customer, stripeSubscriptionId: subId, plan: meta.plan ?? "unknown", status: "active", updatedAt: new Date() };
        await db.insert(subscriptions).values(row).onConflictDoUpdate({ target: subscriptions.stripeSubscriptionId, set: row });
      }
      Object.assign(summary, { subscription: subId, customer, org_id: meta.org_id, firm_id: meta.firm_id, plan: meta.plan });
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
      await db.update(subscriptions).set({ status, currentPeriodEnd: periodEnd(sub), updatedAt: new Date() }).where(eq(subscriptions.stripeSubscriptionId, sub.id));
      Object.assign(summary, { subscription: sub.id, status });
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as unknown as { id: string; subscription?: string | { id: string } | null; parent?: { subscription_details?: { subscription?: string } } };
      const subId = typeof inv.subscription === "string" ? inv.subscription : (inv.subscription?.id ?? inv.parent?.subscription_details?.subscription);
      if (subId) await db.update(subscriptions).set({ status: "past_due", updatedAt: new Date() }).where(eq(subscriptions.stripeSubscriptionId, subId));
      Object.assign(summary, { invoice: inv.id, subscription: subId, status: "past_due" });
      break;
    }
    default:
      break;
  }
  await db.insert(paymentsLog).values({ stripeEventId: event.id, type: event.type, payloadSummary: summary }).onConflictDoNothing();
  return { received: true };
}
