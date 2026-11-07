import { z } from "zod";
import { body, handle, HttpError, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { removeInstall, setRenewal } from "@/lib/checkins";

export const dynamic = "force-dynamic";

const Patch = z.object({ renewalOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable() });
const checkId = (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Install not found");
};

/** Set or clear the renewal date (reschedules the renewal check-in). */
export const PATCH = handle(async (req: Request, { params }: Params<{ org: string; id: string }>) => {
  const { org, id } = await params;
  checkId(id);
  await requireOrgMember(org);
  const b = await body(req, Patch);
  return setRenewal(org, id, b.renewalOn);
});

/** No longer using it: pending check-ins are dropped, finished ones kept. */
export const DELETE = handle(async (_req: Request, { params }: Params<{ org: string; id: string }>) => {
  const { org, id } = await params;
  checkId(id);
  await requireOrgMember(org);
  return removeInstall(org, id);
});
