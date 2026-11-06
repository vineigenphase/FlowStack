/**
 * pnpm crawl:probe <base-url> [...]  — find which common pricing/product paths a vendor site answers.
 * Uses the crawler's own fetcher: identifies as FlowStackBot and respects robots.txt. Vendor sites only.
 * Prints: base  path  status  £-count  xero-count   (so a person can set catalog/apps.yaml crawl paths).
 */
import { loadEnvFiles } from "./_env";
loadEnvFiles();
process.env.LOG_LEVEL ??= "warn";
const { makeFetcher } = await import("@/lib/crawl/fetch");

const PRICING = ["/pricing", "/uk/pricing", "/en-gb/pricing", "/gb/pricing", "/plans", "/pricing-plans", "/prices"];
const fetchPage = makeFetcher();
const count = (t: string, re: RegExp) => (t.match(re) ?? []).length;

for (const base of process.argv.slice(2)) {
  let hit = false;
  for (const p of PRICING) {
    const r = await fetchPage(new URL(p, base).toString());
    if (r.status === "ok" && r.text) {
      console.log(`${base}\t${p}\tok\t£:${count(r.text, /£/g)}\txero:${count(r.text, /xero/gi)}`);
      hit = true;
      break;
    }
    if (r.status === "blocked") {
      console.log(`${base}\t${p}\tblocked-by-robots`);
      hit = true;
      break;
    }
  }
  if (!hit) {
    const home = await fetchPage(base);
    console.log(`${base}\t-\tno pricing page\thome:${home.status}${home.text ? `\txero:${count(home.text, /xero/gi)}` : ""}`);
  }
}
process.exit(0);
