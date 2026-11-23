import { peerPricesEnabled } from "@/lib/prices";
import { guestOn, requireOrgMember } from "@/lib/auth/session";
import { getSettings, INDUSTRIES } from "@/lib/orgs/settings";
import { SettingsForm } from "@/components/settings-form";
import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { subscriptionOf } from "@/lib/api/contract";

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
  const tester = (await subscriptionOf(org)).status === "design_partner";
  return (
    <>
      <h1>Settings</h1>
      <p className="meta">Your industry and markets decide which apps we suggest.</p>
      <SettingsForm org={org} industries={[...INDUSTRIES]} initial={s} peerPrices={peerPricesEnabled()} />
      <h2>Appearance</h2>
      <ThemeToggle />

      <h2>Billing</h2>
      {tester ? <p>You&apos;re a design partner: free, with full access, until launch. Thank you.</p> : null}
      <p>
        <Link href={`/app/${org}/billing`}>Plans and billing</Link>
      </p>
    </>
  );
}
