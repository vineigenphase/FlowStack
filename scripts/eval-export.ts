/**
 * pnpm eval:export [out.csv] — the labelled set as a sheet for a person to review (NEXT-STEPS P1.7).
 * One row per line: org, line, our state, expected state, reason; fill reviewer_state ("ok" or a state) + note.
 */
import fs from "node:fs";
import { loadEnvFiles } from "./_env";
loadEnvFiles();
process.env.LOG_LEVEL ??= "silent";
const { evalFiles, runLabelled } = await import("@/lib/eval/run");
const { toCsv } = await import("@/lib/eval/review");
const out = process.argv[2] ?? "labelled-review.csv";
const results = [];
for (const f of evalFiles()) results.push(...(await runLabelled(f)));
fs.writeFileSync(out, toCsv(results), "utf8");
console.log(`${results.length} lines → ${out}. Fill reviewer_state ("ok" or flagged/covered/fine/marked_fine/snoozed/queued) and reviewer_note, then: pnpm eval:import ${out} --by "<your name>"`);
