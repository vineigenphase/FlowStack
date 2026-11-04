import { handle } from "@/lib/api";
import { getSession } from "@/lib/auth/session";

export const POST = handle(async () => {
  const s = await getSession();
  s.destroy();
  return { ok: true };
});
