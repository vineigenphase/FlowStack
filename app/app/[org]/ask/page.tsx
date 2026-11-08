import Link from "next/link";
import { requireOrgMember } from "@/lib/auth/session";
import { getSettings } from "@/lib/orgs/settings";
import { env } from "@/lib/env";
import { AskBox } from "@/components/ask-box";

export const dynamic = "force-dynamic";

export default async function AskPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireOrgMember(org);
  } catch {
    return null;
  }
  const s = await getSettings(org);
  const written = env().LLM_ENABLED && Boolean(env().ANTHROPIC_API_KEY);
  return (
    <>
      <h1>Ask</h1>
      <p className="meta">
        Ask about apps for your business, e.g. &quot;inventory app for a restaurant group&quot; or &quot;does anything do tronc with Deputy?&quot;.
        Answers come from your own figures and the apps you already use, not a generic list. Nobody can pay to appear.
      </p>
      <AskBox url={`/api/orgs/${org}/ask`} placeholder="What do you need an app for?" />
      {written && !s?.askAi ? (
        <p className="muted small">
          For a written answer as well as the list, turn on &quot;Written answers in Ask&quot; in <Link href={`/app/${org}/settings`}>Settings</Link>.
        </p>
      ) : null}
    </>
  );
}
