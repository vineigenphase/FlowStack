/**
 * Page fetching for the catalogue crawl (BACKEND.md §11.1). Respects robots.txt; uses Tavily Extract
 * when TAVILY_API_KEY is set, otherwise plain fetch + Readability. Vendor sites only — never competitors.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { env } from "@/lib/env";

export const USER_AGENT = "FlowStackBot/0.1 (+catalogue facts; contact svinujan10@gmail.com)";

export type FetchedPage = { status: "ok" | "blocked" | "error"; text: string | null; error?: string };
export type PageFetcher = (url: string) => Promise<FetchedPage>;

/** Minimal robots.txt check for our agent or "*". Longest matching rule wins; Allow beats Disallow on ties. */
export function robotsAllows(robots: string, path: string, agent = "flowstackbot"): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      lastWasAgent = false;
      if (val) cur.rules.push({ allow: key === "allow", path: val });
      else if (key === "disallow") cur.rules.push({ allow: true, path: "/" }); // "Disallow:" = allow all
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of chosen)
    for (const r of g.rules) {
      const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
      if (!re.test(path)) continue;
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  return best ? best.allow : true;
}

const robotsCache = new Map<string, string>();

async function robotsFor(origin: string, fetchImpl: typeof fetch) {
  if (!robotsCache.has(origin)) {
    try {
      const r = await fetchImpl(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT } });
      robotsCache.set(origin, r.ok ? await r.text() : "");
    } catch {
      robotsCache.set(origin, "");
    }
  }
  return robotsCache.get(origin)!;
}

export function htmlToText(html: string): string {
  const { document } = parseHTML(html);
  // Readability works on a document; fall back to body text if it can't find an article.
  const article = new Readability(document as unknown as Document).parse();
  const text = article?.textContent ?? (document.body?.textContent as string | undefined) ?? "";
  return text.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function makeFetcher(fetchImpl: typeof fetch = fetch): PageFetcher {
  return async (url) => {
    const u = new URL(url);
    if (!robotsAllows(await robotsFor(u.origin, fetchImpl), u.pathname)) return { status: "blocked", text: null };
    try {
      const key = env().TAVILY_API_KEY;
      if (key) {
        const r = await fetchImpl("https://api.tavily.com/extract", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ urls: [url] }),
        });
        if (r.ok) {
          const j = (await r.json()) as { results?: { raw_content?: string }[] };
          const text = j.results?.[0]?.raw_content;
          if (text) return { status: "ok", text };
        }
        // fall through to plain fetch
      }
      const r = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept: "text/html" }, redirect: "follow" });
      if (!r.ok) return { status: "error", text: null, error: `HTTP ${r.status}` };
      return { status: "ok", text: htmlToText(await r.text()) };
    } catch (e) {
      return { status: "error", text: null, error: (e as Error).message.slice(0, 200) };
    }
  };
}
