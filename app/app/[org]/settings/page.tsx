import { requireOrgMember } from "@/lib/auth/session";
import { getSettings, INDUSTRIES } from "@/lib/orgs/settings";
import { SettingsForm } from "@/components/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireOrgMember(org);
  } catch {
    return null;
  }
  const s = await getSettings(org);
  if (!s) return null;
  return (
    <>
      <h1>Settings</h1>
      <p className="meta">Your industry and markets decide which apps we suggest and which businesses you&apos;re compared with.</p>
      <SettingsForm org={org} industries={[...INDUSTRIES]} initial={s} />
    </>
  );
}
