import { z } from "zod";
import { body, handle } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { createFirm, myFirms } from "@/lib/firms";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const u = await requireUser();
  return { firms: await myFirms(u.userId) };
});

/** Start a practice. The creator is its owner. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const b = await body(req, z.object({ name: z.string().trim().min(2).max(120) }));
  const f = await createFirm(u.userId, b.name);
  return { ...f, next: `/practice/${f.id}` };
});
