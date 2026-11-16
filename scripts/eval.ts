/**
 * pnpm eval — run the pipeline on every /fixtures/labelled/*.json and print FP and missed-flag rates per rule.
 * Exits 1 when the overall FP rate is above FP_GATE (0.15 for 1.0). `--verbose` lists every mismatch.
 */
import { loadEnvFiles } from "./_env";
loadEnvFiles();
process.env.LOG_LEVEL ??= "silent";

const { evalFiles, runLabelled, scoreEval, signOffStatus } = await import("@/lib/eval/run");
const { env } = await import("@/lib/env");

const files = evalFiles();
if (!files.length) {
  console.error("No labelled orgs in fixtures/labelled/. Run: pnpm tsx scripts/make-labelled.ts");
  process.exit(1);
}
const results = [];
for (const f of files) results.push(...(await runLabelled(f)));
const s = scoreEval(results);
const pct = (n: number | null) => (n === null ? "   –  " : `${(n * 100).toFixed(1).padStart(5)}%`);

console.log(`\nLabelled orgs: ${files.length}   lines: ${results.length}   state agreement: ${pct(s.stateAgreement)}\n`);
console.log("rule                     flagged    FP   FP rate   labelled  missed  missed rate");
for (const r of [...s.rules, s.overall]) {
  if (r.rule === "overall") console.log("-".repeat(80));
  console.log(
    `${r.rule.padEnd(24)} ${String(r.predictedFlagged).padStart(7)} ${String(r.falsePositives).padStart(5)}   ${pct(r.fpRate)}   ${String(r.labelledFlagged).padStart(8)} ${String(r.missed).padStart(7)}   ${pct(r.missedRate)}`,
  );
}
if (process.argv.includes("--verbose")) {
  console.log("\nMismatches (predicted → labelled):");
  for (const m of s.mismatches) console.log(`  ${m.org.padEnd(26)} ${m.lineKey.padEnd(10)} ${(m.ruleId ?? "").padEnd(20)} ${m.predicted} → ${m.expected}`);
}
const gate = env().FP_GATE;
const fp = s.overall.fpRate ?? 0;
// NEXT-STEPS P1.7: the gate only counts once a person has signed off the labels (pnpm eval:import --by <name>).
const { drafts } = signOffStatus(files);
if (drafts.length) {
  console.log(`\nFP gate ${pct(gate)}: provisional ${fp > gate ? "FAIL" : "pass"} (overall FP rate ${pct(fp)}) — labels not signed off by a person: ${drafts.join(", ")}`);
  console.log("Export for review: pnpm eval:export · then: pnpm eval:import <file.csv> --by \"<name>\"");
  process.exit(0);
}
console.log(`\nFP gate ${pct(gate)}: ${fp > gate ? "FAIL" : "pass"} (overall FP rate ${pct(fp)})`);
process.exit(fp > gate ? 1 : 0);
