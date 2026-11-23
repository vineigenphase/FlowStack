import { devToolsOn, queueSummary } from "@/lib/dev/tools";
import { panelLines } from "@/lib/dev/lines";
import { DevTools } from "./dev-tools";

/**
 * ENGINE-V2 §2.1: renders the dev rail + Engine panel only for admins with DEV_TOOLS=true (checked here, on the
 * server). Customers, testers, demo guests and the public get nothing: no markup and no data.
 */
export async function DevMount({ org = null }: { org?: string | null }) {
  if (!(await devToolsOn())) return null;
  const [summary, lines] = await Promise.all([queueSummary(), org ? panelLines(org) : Promise.resolve([])]);
  return <DevTools org={org} lines={lines} initialSummary={summary} />;
}
