import { handle } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { fpReport } from "@/lib/feedback";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** FP rate overall / per rule (id@version) / per ISO week, from users' answers. */
export const GET = handle(async () => {
  await requireAdmin();
  return { gate: env().FP_GATE, ...(await fpReport()) };
});
