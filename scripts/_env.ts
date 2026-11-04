import fs from "node:fs";

/** Minimal .env.local / .env loader for CLI scripts (Next loads these itself for the app). */
export function loadEnvFiles(files: string[] = [".env.local", ".env"]) {
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!.replace(/\s+#.*$/, "").trim();
      if (/^".*"$/.test(val)) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}
