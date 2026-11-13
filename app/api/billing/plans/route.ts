import { handle } from "@/lib/api";
import { plansView } from "@/lib/api/contract";

export const dynamic = "force-dynamic";

/** Plan cards (UI-SPEC §5.15). Prices come from catalog/plans.yaml only and stay null while they are OPEN. */
export const GET = handle(async () => plansView());
