import { peerPricesEnabled } from "@/lib/prices";
import { guestOn, requireOrgMember } from "@/lib/auth/session";
import { getSettings, INDUSTRIES } from "@/lib/orgs/settings";
import { SettingsForm } from "@/components/settings-form";
import { BillingBox } from "@/components/billing-box";
import { billingStatus, plans, subscriptionFor } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (await guestOn(org)) {
    return (
      <section className="panel">
        <h2>Settings isn&apos;t part of the demo</h2>
        <p>This is a sample business. Connect your own Xero to use settings.</p>
      </section>
    );
  }
  try {
    await requireOrgMember(org);
  } catch {
    return null;
  }
  const s = await getSettings(org);
  if (!s) return null;
  const bill = billingStatus();
  const sub = bill.enabled ? await subscriptionFor({ orgId: org }) : null;
  return (
    <>
      <h1>Settings</h1>
      <p className="meta">Your industry and markets decide which apps we suggest.</p>
      <SettingsForm org={org} industries={[...INDUSTRIES]} initial={s} peerPrices={peerPricesEnabled()} />

      <h2>Billing</h2>
      {bill.enabled ? (
        <>
          <p className="muted small">Payments are handled by Stripe; we never see your card. Test mode: no real money moves.</p>
          <BillingBox
            org={org}
            plans={plans().plans.map((p) => ({ key: p.key, label: p.label, price: p.price_gbp === null ? "price to be confirmed" : `£${p.price_gbp}` }))}
            subscribed={Boolean(sub && sub.status !== "canceled")}
            status={sub?.status ?? null}
          />
        </>
      ) : (
        <p className="muted">{bill.reason}</p>
      )}
    </>
  );
}
