import { z } from "zod";
import { body, handle, HttpError } from "@/lib/api";
import { getSession, requireUser } from "@/lib/auth/session";
import { JobTitle, setJobTitle } from "@/lib/me";
import { me } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

async function current(userId: string) {
  const s = await getSession();
  const out = await me(userId, s.activeOrgId ?? null);
  if (!out) throw new HttpError(401, "Sign in with Xero first");
  return out;
}

/** UI-SPEC §8 `Me`: the user, their businesses (for the switcher) and the active one. */
export const GET = handle(async () => {
  const u = await requireUser();
  return current(u.userId);
});

/** Job title, asked once (v1.1 A). Changes no permissions. PUT returns `Me` (UI-SPEC); PATCH is the older form. */
export const PUT = handle(async (req: Request) => {
  const u = await requireUser();
  const b = await body(req, z.object({ jobTitle: JobTitle }));
  await setJobTitle(u.userId, b.jobTitle);
  return current(u.userId);
});

export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  const b = await body(req, z.object({ jobTitle: JobTitle }));
  await setJobTitle(u.userId, b.jobTitle);
  return { ok: true };
});
