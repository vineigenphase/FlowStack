import { z } from "zod";
import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember, requireOrgReader } from "@/lib/auth/session";
import { getSettings, saveSettings, SettingsInput } from "@/lib/orgs/settings";
import { settingsOf } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** UI-SPEC §8 OrgSettings. */
export const GET = handle(async (_req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgReader(org);
  const s = await settingsOf(org);
  if (!s) throw new HttpError(404, "Org not found");
  return s;
});

const Contract = z.object({
  markets: z.array(z.enum(["UK", "US", "CA", "AU"])).min(1, "Pick at least one market"),
  industry: z.enum(["ecommerce", "saas", "other"]).nullable(),
  includeCurrentMonth: z.boolean(),
  benchmarkOptIn: z.boolean(),
  digestOptIn: z.boolean(),
});

/** Save the UI-SPEC settings. digestOptIn is stored (round-2 3d); no email is sent until a provider is chosen. */
export const PUT = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const u = await requireOrgMember(org);
  const b = await body(req, Contract);
  const before = await getSettings(org);
  // "Other" in the contract covers our finer industries (hospitality, retail…): don't flatten a stored one.
  const keepFiner = b.industry === "other" && before?.industry && before.industry !== "ecommerce" && before.industry !== "saas";
  await saveSettings(org, u.userId, {
    markets: b.markets,
    ...(keepFiner ? {} : { industry: b.industry }),
    includeCurrentMonth: b.includeCurrentMonth,
    sharePrices: b.benchmarkOptIn,
    digestOptIn: b.digestOptIn,
  });
  return settingsOf(org);
});

/** The older form used by the settings page (industry list, price sharing, Ask). */
export const PATCH = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  const u = await requireOrgMember(org);
  return saveSettings(org, u.userId, await body(req, SettingsInput));
});
