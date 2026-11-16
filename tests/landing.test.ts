/** NEXT-STEPS P1.11: landing calculator maths, and every stat on the page carries a source link. */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { decisionCost, HOURS_PER_YEAR } from "@/components/salary-calculator";
import { STATS } from "@/components/landing";

describe("time is salary", () => {
  it("hourly = salary ÷ 1,800; decision = hourly × hours (UI-SPEC §5.1 defaults)", () => {
    expect(HOURS_PER_YEAR).toBe(1800);
    const { hourly, total } = decisionCost(55_000, 10);
    expect(hourly).toBeCloseTo(30.56, 2);
    expect(total).toBeCloseTo(305.56, 2);
  });
  it("nonsense input gives £0, not NaN or a negative", () => {
    expect(decisionCost(0, 10).total).toBe(0);
    expect(decisionCost(55_000, -3).total).toBe(0);
  });
});

describe("landing stats", () => {
  it("each stat has a first-party https source, a label and a checked date", () => {
    expect(STATS.length).toBeGreaterThan(0);
    for (const s of STATS) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.source.length).toBeGreaterThan(3);
      expect(s.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it("the landing has no unsourced figures outside STATS (no digits in its prose)", () => {
    const src = fs.readFileSync("components/landing.tsx", "utf8");
    const body = src.slice(src.indexOf("export function Landing"));
    // Only the step numbers in the list and the STATS map are allowed; prose figures must come from STATS.
    expect(body.replace(/s\.\w+/g, "")).not.toMatch(/[£$]\s?\d|\d+(,\d{3})+|\d+%/);
  });
});
