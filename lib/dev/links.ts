/**
 * Every useful admin / dev link, for the copy-paste list (/admin/links, the Debug and Review queue pages).
 * Paths only; the page adds the site's own address so the same list works on preview and production.
 * Owner connection for the business list: never call from inside withOrg().
 */
import { asc } from "drizzle-orm";
import { orgs } from "@/db/schema";
import { adminDb } from "@/lib/db/client";
import { KIND_LABELS } from "@/lib/queue/view";
import type { PanelLine } from "./lines";

export type DevLink = { label: string; path: string; note?: string };
export type LinkGroup = { title: string; links: DevLink[] };

export const SITES = [
  { label: "Production", url: "https://flowstack-xi-ten.vercel.app" },
  { label: "Preview (dev branch)", url: "https://flowstack-git-dev-flow-stack1.vercel.app" },
];

export function generalLinks(): LinkGroup[] {
  return [
    {
      title: "Admin pages",
      links: [
        { label: "All dev links", path: "/admin/links" },
        { label: "Engine v2: weights, matches, category map", path: "/admin/engine-v2" },
        { label: "Review queue", path: "/admin/queue" },
        ...Object.entries(KIND_LABELS).map(([k, label]) => ({ label: `Review queue: ${label}`, path: `/admin/queue#${k}` })),
        { label: "Testers, waitlist and invite codes", path: "/admin/testers" },
      ],
    },
    {
      title: "Dev APIs (DEV_TOOLS=true + admin; 404 otherwise)",
      links: [
        { label: "Review queue summary (JSON)", path: "/api/admin/queue/summary" },
        { label: "App database record (JSON), e.g. Chaser", path: "/api/dev/appdb/chaser", note: "replace chaser with any app id" },
        { label: "Health check", path: "/api/health" },
      ],
    },
    {
      title: "Public pages",
      links: [
        { label: "Home / landing", path: "/" },
        { label: "Apps directory", path: "/apps" },
        { label: "Read-only demo (needs DEMO_ENABLED)", path: "/demo" },
        { label: "Connect Xero", path: "/connect" },
      ],
    },
  ];
}

export function orgLinks(org: string, lines: PanelLine[] = []): LinkGroup[] {
  const lineKey = (k: string) => encodeURIComponent(k);
  return [
    {
      title: "This business",
      links: [
        { label: "Summary", path: `/app/${org}` },
        { label: "Profit and loss", path: `/app/${org}/statements/pl` },
        { label: "Balance sheet", path: `/app/${org}/statements/bs` },
        { label: "Cash flow", path: `/app/${org}/statements/cf` },
        { label: "Stack map", path: `/app/${org}/map` },
        { label: "Ask", path: `/app/${org}/ask` },
        { label: "After install", path: `/app/${org}/after` },
        { label: "Reviews", path: `/app/${org}/reviews` },
        { label: "Settings (incl. Appearance)", path: `/app/${org}/settings` },
        { label: "Billing", path: `/app/${org}/billing` },
        { label: "Debug: refreshes and steps", path: `/admin/debug/${org}` },
        { label: "Monthly digest preview", path: `/admin/digest/${org}` },
        { label: "Review queue summary for this business (JSON)", path: `/api/admin/queue/summary?org=${org}` },
      ],
    },
    ...(lines.length
      ? [
          {
            title: "Flagged and covered lines (page · v2 trace · v1 trace)",
            links: lines.flatMap((l) => [
              { label: `${l.name} (${l.state})`, path: `/app/${org}/lines/${lineKey(l.lineKey)}` },
              { label: `${l.name}: engine v2 trace (JSON)`, path: `/api/dev/engine/${org}/${lineKey(l.lineKey)}?engine=v2` },
              { label: `${l.name}: engine v1 trace (JSON)`, path: `/api/dev/engine/${org}/${lineKey(l.lineKey)}?engine=v1` },
            ]),
          },
        ]
      : []),
  ];
}

export async function allBusinesses(): Promise<{ id: string; name: string; sample: boolean }[]> {
  return (await adminDb()).select({ id: orgs.id, name: orgs.name, sample: orgs.sample }).from(orgs).orderBy(asc(orgs.name));
}
