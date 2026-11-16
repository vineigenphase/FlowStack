/**
 * Monthly digest (round-2 3d, NEXT-STEPS P2.13): one email per business, 7 days before its billing date.
 * Template only: no LLM, built from the same read models the pages use (counts, £ totals of its own lines, app names),
 * never transactions. Composed and previewed now (/admin/digest/[org]); NOT sent: sending waits for an email provider
 * (`RESEND_API_KEY` once one is chosen). Nothing here talks to a mail service.
 */
import { eq } from "drizzle-orm";
import { orgs } from "@/db/schema";
import { withOrg } from "@/lib/db/client";
import { env } from "@/lib/env";
import { subscriptionOf, summary } from "@/lib/api/contract";
import type { Summary } from "@/lib/api/types";
import { gbp } from "@/lib/ui/format";

export const DAYS_BEFORE_BILLING = 7;

export type DigestData = {
  orgId: string;
  orgName: string;
  appUrl: string;
  sample: boolean;
  summary: Summary | null;
};

export type Digest = { subject: string; text: string; html: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The billing date minus 7 days, or null when there's no paid subscription (design partners, no plan). */
export function sendOn(currentPeriodEnd: string | null): string | null {
  if (!currentPeriodEnd) return null;
  const d = new Date(currentPeriodEnd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - DAYS_BEFORE_BILLING);
  return d.toISOString().slice(0, 10);
}

type Block = { heading: string; items: { text: string; href?: string }[] };

/** Pure: the digest's sections, in order. Empty sections are left out. */
export function digestBlocks(d: DigestData): { lede: string; blocks: Block[] } {
  const s = d.summary;
  const base = `${d.appUrl}/app/${d.orgId}`;
  if (!s || !s.lastRefreshAt) return { lede: "We haven't read your books yet. Refresh from Xero to see where they point.", blocks: [] };
  const lede =
    s.flaggedLines > 0
      ? `${gbp(s.atStake)} ${s.atStakeLabel.toLowerCase()} across ${s.flaggedLines} ${s.flaggedLines === 1 ? "line" : "lines"} (${s.period.label}).`
      : `Nothing flagged for ${s.period.label}.`;
  const blocks: Block[] = [];
  const action = s.banners.filter((b) => b.kind !== "sample");
  if (action.length) blocks.push({ heading: "Needs you", items: action.map((b) => ({ text: b.message, href: b.action ? `${d.appUrl}${b.action.href}` : undefined })) });
  if (s.biggestLines.length)
    blocks.push({
      heading: "Biggest flagged lines",
      items: s.biggestLines.slice(0, 3).map((l) => ({ text: `${l.name}: ${gbp(l.value)}`, href: `${base}/lines/${encodeURIComponent(l.key)}` })),
    });
  const trends = s.trends.filter((t) => t.flagged);
  if (trends.length) blocks.push({ heading: "Trends to watch", items: trends.map((t) => ({ text: `${t.label}: ${t.latest} ${t.unit}`, href: t.lineKey ? `${base}/lines/${encodeURIComponent(t.lineKey)}` : base })) });
  if (s.questions.length)
    blocks.push({
      heading: "Questions about your apps",
      items: s.questions.map((q) => ({
        text:
          q.kind === "lapsing"
            ? `Still using ${q.appName}? ${q.lastPaid ? `The last payment we saw was on ${day(q.lastPaid)}.` : "We haven't seen a recent payment."}`
            : `Has ${q.replacementAppName ?? "another app"} replaced ${q.appName}?`,
        href: base,
      })),
    });
  return { lede, blocks };
}

export function renderDigest(d: DigestData): Digest {
  const { lede, blocks } = digestBlocks(d);
  const tag = d.sample ? " (sample data)" : "";
  const subject = `${d.orgName}${tag}: your month in FlowStack`;
  const overview = `${d.appUrl}/app/${d.orgId}`;
  const settings = `${overview}/settings`;
  const footer = "You get this because monthly emails are on in Settings. No app pays to appear in FlowStack.";

  const text = [
    `${d.orgName}${tag}`,
    "",
    lede,
    ...blocks.flatMap((b) => ["", b.heading, ...b.items.map((i) => `- ${i.text}${i.href ? ` (${i.href})` : ""}`)]),
    "",
    `Open FlowStack: ${overview}`,
    "",
    footer,
    `Turn these emails off: ${settings}`,
  ].join("\n");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px;background:#ffffff;color:#111111;font:16px/1.5 Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto">
<p style="font-size:13px;color:#555555;margin:0 0 4px">FlowStack · monthly</p>
<h1 style="font-size:22px;margin:0 0 12px">${esc(d.orgName)}${esc(tag)}</h1>
<p style="margin:0 0 16px">${esc(lede)}</p>
${blocks
  .map(
    (b) => `<h2 style="font-size:16px;margin:20px 0 6px">${esc(b.heading)}</h2>
<ul style="margin:0;padding-left:18px">${b.items.map((i) => `<li style="margin:4px 0">${i.href ? `<a href="${esc(i.href)}" style="color:#111111">${esc(i.text)}</a>` : esc(i.text)}</li>`).join("")}</ul>`,
  )
  .join("\n")}
<p style="margin:24px 0"><a href="${esc(overview)}" style="display:inline-block;background:#111111;color:#ffffff;padding:10px 16px;text-decoration:none;font-weight:bold">Open FlowStack</a></p>
<p style="font-size:13px;color:#555555;margin:0">${esc(footer)} <a href="${esc(settings)}" style="color:#555555">Turn these emails off</a>.</p>
</div></body></html>`;
  return { subject, text, html };
}

/** Everything the admin preview needs: the email, whether it would go, and when. */
export async function composeDigest(orgId: string) {
  const [o] = await withOrg(orgId, (tx) => tx.select({ name: orgs.name, sample: orgs.sample, optIn: orgs.digestOptIn }).from(orgs).where(eq(orgs.id, orgId)));
  if (!o) return null;
  const [s, sub] = await Promise.all([summary(orgId), subscriptionOf(orgId)]);
  const digest = renderDigest({ orgId, orgName: o.name, appUrl: env().APP_URL, sample: o.sample, summary: s });
  return { ...digest, optedIn: o.optIn, sendOn: sendOn(sub.currentPeriodEnd), subscription: sub.status, sending: false as const };
}
