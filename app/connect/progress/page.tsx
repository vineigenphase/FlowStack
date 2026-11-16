import Link from "next/link";
import { eq } from "drizzle-orm";
import { syncRuns } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { requireOrgReader } from "@/lib/auth/session";
import { refreshRun } from "@/lib/api/contract";
import { RunProgress } from "@/components/run-progress";

export const dynamic = "force-dynamic";

/** First refresh progress (UI-SPEC §5.3, NEXT-STEPS P0.3). Plain and design-neutral. */
export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ run?: string; capped?: string }> }) {
  const { run, capped } = await searchParams;
  const notFound = (
    <main className="wrap">
      <h1>Refresh not found</h1>
      <p>
        This link has expired or isn&apos;t yours. <Link href="/">Home</Link>
      </p>
    </main>
  );
  if (!run || !/^[0-9a-f-]{36}$/i.test(run)) return notFound;
  const [r] = await (await adminDb()).select({ orgId: syncRuns.orgId }).from(syncRuns).where(eq(syncRuns.id, run));
  if (!r) return notFound;
  try {
    await requireOrgReader(r.orgId);
  } catch {
    return notFound;
  }
  const initial = await refreshRun(r.orgId, run);
  if (!initial) return notFound;
  return (
    <main className="wrap">
      <h1>Reading your books from Xero</h1>
      <p className="muted">Read-only. This usually takes under two minutes.</p>
      {capped ? <p className="banner">Some businesses weren&apos;t added: you&apos;ve reached the number we can connect right now.</p> : null}
      <RunProgress org={r.orgId} initial={initial} />
    </main>
  );
}
