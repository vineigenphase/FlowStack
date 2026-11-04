/** pnpm crawl [appId ...] — crawl vendor pages and update fact states. No ids → whole catalogue. */
import { loadEnvFiles } from "./_env";
loadEnvFiles();
process.env.LOG_LEVEL ??= "warn";
const { crawlApp, crawlAll } = await import("@/lib/crawl");
const ids = process.argv.slice(2);
const results = ids.length ? await Promise.all(ids.map((id) => crawlApp(id))) : await crawlAll();
for (const r of results) {
  console.log(`\n${r.appId}  pages: ${JSON.stringify(r.pages)}${r.skipped ? "  (unchanged / skipped)" : ""}`);
  if (r.found.length) console.log(`  found:       ${r.found.join(", ")}`);
  if (r.conflicting.length) console.log(`  conflicting: ${r.conflicting.join(", ")}`);
  if (r.missing.length) console.log(`  missing:     ${r.missing.length} fields`);
  console.log(`  quotes rejected: ${r.rejectedQuotes}   queue items: ${r.queued}`);
}
process.exit(0);
