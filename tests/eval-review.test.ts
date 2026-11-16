/** NEXT-STEPS P1.7: the labelled set goes out as a sheet, comes back with a person's corrections and sign-off. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importReview, parseCsv, toCsv } from "@/lib/eval/review";
import { signOffStatus } from "@/lib/eval/run";

describe("review sheet", () => {
  it("round-trips quotes, commas and newlines", () => {
    const csv = toCsv([{ org: "o", lineKey: "pl:1", ruleId: null, predicted: "flagged", expected: "fine", labelled: true, name: 'Rent, "office"', why: "line one\nline two" }]);
    const [head, row] = parseCsv(csv);
    expect(head).toEqual(["org", "line_key", "line_name", "our_state", "expected_state", "reason", "reviewer_state", "reviewer_note"]);
    expect(row).toEqual(["o", "pl:1", 'Rent, "office"', "flagged", "fine", "line one\nline two", "", ""]);
  });

  it("applies corrections, keeps the rest, signs off; a bad state writes nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labels-"));
    fs.copyFileSync("fixtures/labelled/copperpot.json", path.join(dir, "copperpot.json"));
    const before = JSON.parse(fs.readFileSync(path.join(dir, "copperpot.json"), "utf8"));
    const key = Object.keys(before.expected)[0] as string;
    expect(signOffStatus([path.join(dir, "copperpot.json")]).drafts).toEqual(["copperpot"]);

    const head = "org,line_key,line_name,our_state,expected_state,reason,reviewer_state,reviewer_note\n";
    const bad = importReview(head + `copperpot,${key},x,flagged,${before.expected[key]},,maybe,\n`, "Luke", dir);
    expect(bad.problems).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "copperpot.json"), "utf8")).signed_off).toBeUndefined();

    const to = before.expected[key] === "fine" ? "flagged" : "fine";
    const r = importReview(head + `copperpot,${key},x,flagged,${before.expected[key]},,${to},Payroll is outsourced\ncopperpot,pl:999,y,fine,fine,,ok,\n`, "Luke", dir, new Date("2026-11-20T09:00:00Z"));
    expect(r).toMatchObject({ confirmed: 1, orgs: ["copperpot"], problems: [] });
    expect(r.changed).toEqual([{ org: "copperpot", lineKey: key, from: before.expected[key], to }]);
    const after = JSON.parse(fs.readFileSync(path.join(dir, "copperpot.json"), "utf8"));
    expect(after.expected[key]).toBe(to);
    expect(after.why[key]).toBe("Payroll is outsourced");
    expect(after.signed_off).toEqual({ by: "Luke", at: "2026-11-20T09:00:00.000Z" });
    expect(after.xero).toEqual(before.xero); // the fixture data is untouched
    expect(signOffStatus([path.join(dir, "copperpot.json")]).signed).toEqual(["copperpot"]);
  });
});
