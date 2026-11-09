import { z } from "zod";
import { body, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { getMe, JobTitle, setJobTitle } from "@/lib/me";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const u = await requireUser();
  return getMe(u.userId);
});

/** Asked once after sign-up (v1.1 A). Changes no permissions. */
export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  const b = await body(req, z.object({ jobTitle: JobTitle }));
  await setJobTitle(u.userId, b.jobTitle);
  return { ok: true };
});
