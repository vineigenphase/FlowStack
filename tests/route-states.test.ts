/** NEXT-STEPS P0.4: every /app/[org] route and /apps has a loading and an error state. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function pageDirs(root: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) out.push(...pageDirs(p));
    else if (e.name === "page.tsx") out.push(root);
  }
  return out;
}

describe("route states", () => {
  const dirs = [...pageDirs("app/app/[org]"), ...pageDirs("app/apps")];
  it.each(dirs)("%s has loading.tsx and error.tsx", (dir) => {
    expect(fs.existsSync(path.join(dir, "loading.tsx"))).toBe(true);
    const err = path.join(dir, "error.tsx");
    expect(fs.existsSync(err)).toBe(true);
    expect(fs.readFileSync(err, "utf8")).toMatch(/^"use client";/);
  });
  it("found every route", () => expect(dirs.length).toBeGreaterThanOrEqual(10));
});
