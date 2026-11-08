import { getPlaybooks, requireFirmMember } from "@/lib/firms";
import { appCategories, apps as catalogApps } from "@/lib/catalog/load";
import { INDUSTRIES } from "@/lib/orgs/settings";
import { PlaybookSelect } from "@/components/practice-forms";

export const dynamic = "force-dynamic";

const OFF = new Set(["accounting", "other_software"]);

/** The firm's standard stack per industry. Clients that differ show as "off playbook" on the Clients page. */
export default async function PlaybooksPage({ params, searchParams }: { params: Promise<{ firm: string }>; searchParams: Promise<{ industry?: string }> }) {
  const { firm } = await params;
  const { industry: q } = await searchParams;
  try {
    await requireFirmMember(firm);
  } catch {
    return null;
  }
  const industry = INDUSTRIES.find((i) => i.key === q)?.key ?? INDUSTRIES[0].key;
  const pb = await getPlaybooks(firm);
  const jobs = appCategories().filter((c) => !OFF.has(c.key));
  const set = pb.filter((p) => p.industry === industry);

  return (
    <>
      <h1>Playbooks</h1>
      <p className="meta">
        Pick the app your practice sets up for each job, per industry. Clients in that industry that use something else, or nothing, are flagged
        on the Clients page. A client&apos;s industry is set on its Settings tab.
      </p>
      <nav className="chips" aria-label="Industry">
        {INDUSTRIES.map((i) => (
          <a key={i.key} href={`/practice/${firm}/playbooks?industry=${i.key}`} aria-current={i.key === industry ? "page" : undefined}>
            {i.label} <span className="muted small">{pb.filter((p) => p.industry === i.key).length || ""}</span>
          </a>
        ))}
      </nav>
      <div className="playbook">
        {jobs.map((j) => (
          <PlaybookSelect
            key={`${industry}-${j.key}`}
            firm={firm}
            industry={industry}
            jobKey={j.key}
            jobLabel={j.label}
            value={set.find((p) => p.jobKey === j.key)?.appId ?? null}
            options={catalogApps()
              .filter((a) => a.categories.includes(j.key))
              .map((a) => ({ id: a.id, name: a.name }))
              .sort((a, b) => a.name.localeCompare(b.name))}
          />
        ))}
      </div>
      <p className="muted small">Your playbook is yours: it never changes how FlowStack ranks apps, and no app pays to appear.</p>
    </>
  );
}
