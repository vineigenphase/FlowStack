import { body, handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { getSettings, saveSettings, SettingsInput } from "@/lib/orgs/settings";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  return getSettings(org);
});

export const PATCH = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const u = await requireOrgMember(org);
  return saveSettings(org, u.userId, await body(req, SettingsInput));
});
