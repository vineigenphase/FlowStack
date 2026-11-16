/** pnpm eval:import <reviewed.csv> --by "<name>" — apply a person's corrections and sign the labels off (NEXT-STEPS P1.7). */
import fs from "node:fs";
import path from "node:path";
const { importReview } = await import("@/lib/eval/review");
const file = process.argv[2];
const by = process.argv[process.argv.indexOf("--by") + 1];
if (!file || !process.argv.includes("--by") || !by) {
  console.error('Usage: pnpm eval:import <reviewed.csv> --by "<your name>"');
  process.exit(1);
}
const r = importReview(fs.readFileSync(file, "utf8"), by, path.resolve(process.cwd(), "fixtures/labelled"));
if (r.problems.length) {
  console.error("Nothing written. Fix these rows first:\n  " + r.problems.join("\n  "));
  process.exit(1);
}
console.log(`Signed off by ${by}: ${r.orgs.join(", ")}. ${r.confirmed} labels confirmed, ${r.changed.length} changed:`);
for (const c of r.changed) console.log(`  ${c.org} ${c.lineKey}: ${c.from} → ${c.to}`);
console.log("Now run pnpm eval: the gate counts from here.");
