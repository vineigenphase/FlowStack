import { handle, HttpError, type Params } from "@/lib/api";
import { engineTrace, requireDevTools } from "@/lib/rank/v2/dev";

export const dynamic = "force-dynamic";

/**
 * ENGINE-V2 §1.3: the engine trace for one line of the latest refresh.
 *   GET /api/dev/engine/:org/:lineKey?engine=v1|v2&weights=<json>
 * 404 unless DEV_TOOLS=true and the signed-in user is an admin. `weights` is a what-if override of
 * rules.yaml → scoring_v2 (v2 only); it is never saved.
 */
export const GET = handle(async (req: Request, { params }: Params<{ org: string; lineKey: string }>) => {
  await requireDevTools();
  const { org, lineKey } = await params;
  const q = new URL(req.url).searchParams;
  const engine = q.get("engine") === "v1" ? "v1" : "v2";
  let weights: unknown = null;
  if (q.get("weights")) {
    try {
      weights = JSON.parse(q.get("weights")!);
    } catch {
      throw new HttpError(400, "weights must be JSON");
    }
  }
  return engineTrace(org, decodeURIComponent(lineKey), engine, weights);
});
