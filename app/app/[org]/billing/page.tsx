import Link from "next/link";
import { guestOn, requireOrgMember } from "@/lib/auth/session";
import { BillingBox } from "@/components/billing-box";
import { billingStatus } from "@/lib/billing";
import { plansView, subscriptionOf } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/**
 * Billing (UI-SPEC §5.15, NEXT-STEPS P1.12), plain until the designer's version. Prices only from plans.yaml;
 * while none is set the page says "Plans coming soon". Design partners see a thank-you, never a checkout.
 */
export default async function BillingPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ billing?: string }> }) {
  const { org } = await params;
  const { billing } = await searchParams;
  if (await guestOn(org)) {
    return (
      <section className="panel">
        <h2>Billing isn&apos;t part of the demo</h2>
        <p>This is a sample business. Connect your own Xero to see plans.</p>
      </section>
    );
  }
  try {
    await requireOrgMember(org);
  } catch {
    return null;
  }
  const sub = await subscriptionOf(org);
  const plans = plansView().filter((p) => p.available);
  const priced = plans.some((p) => p.priceGbp !== null);
  const bill = billingStatus();
  return (
    <>
      <h1>Billing</h1>
      {billing === "done" ? <p className="banner" role="status">You&apos;re all set. Thank you.</p> : null}
      {billing === "cancelled" ? <p className="banner" role="status">No charge made.</p> : null}
      {sub.status === "design_partner" ? (
        <p>You&apos;re a design partner: free until launch. Thank you.</p>
      ) : sub.status === "active" || sub.status === "past_due" ? (
        <BillingBox org={org} plans={plans} subscribed status={sub.status === "past_due" ? "payment failed" : "active"} renews={sub.currentPeriodEnd} />
      ) : !priced ? (
        <p>Plans coming soon.</p>
      ) : !bill.enabled ? (
        <p className="muted">{bill.reason}</p>
      ) : (
        <>
          <p className="muted small">Payments are handled by Stripe; we never see your card. Test mode: no real money moves.</p>
          <BillingBox org={org} plans={plans} subscribed={false} status={null} renews={null} />
        </>
      )}
      <p className="muted small">
        <Link href={`/app/${org}/settings`}>Back to settings</Link>
      </p>
    </>
  );
}
