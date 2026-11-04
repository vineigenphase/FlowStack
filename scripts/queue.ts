/** pnpm queue [kind] — print open review items, oldest first. */
import { loadEnvFiles } from "./_env";
loadEnvFiles();
const { listQueue } = await import("@/lib/queue/resolve");
const items = await listQueue({ kind: process.argv[2] });
if (!items.length) console.log("Queue is empty.");
for (const i of items) console.log(`${i.createdAt.toISOString().slice(0, 16)}  ${i.kind.padEnd(22)} ${i.id}  ${i.reason}`);
process.exit(0);
