/** Admin sign-in: return addresses stay on this site; every /admin page offers sign-in instead of a dead end. */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/ui/signin";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/admin/links")).toBe("/admin/links");
    expect(safeNext("/admin/debug/abc?x=1")).toBe("/admin/debug/abc?x=1");
  });
  it("drops other sites and junk", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "admin", "", null, undefined, "/" + "a".repeat(300)]) expect(safeNext(bad)).toBeUndefined();
  });
});

describe("admin pages", () => {
  it("each shows the sign-in block when the visitor isn't an admin", () => {
    for (const f of ["app/admin/page.tsx", "app/admin/engine-v2/page.tsx", "app/admin/links/page.tsx", "app/admin/queue/page.tsx", "app/admin/testers/page.tsx", "app/admin/debug/[org]/page.tsx", "app/admin/digest/[org]/page.tsx"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).toMatch(/<AdminSignIn next=/);
      expect(src, f).not.toMatch(/This page is for the FlowStack team\.<\/p>/);
    }
  });
});
