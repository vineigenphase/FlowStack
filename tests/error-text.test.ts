/** Logged errors never carry SQL parameters (ledger values, emails): message and stack. */
import { describe, expect, it } from "vitest";
import { errorText, safeStack } from "@/lib/sync/error-text";

const failed = () => {
  const e = new Error('Failed query: insert into "waitlist" ("email") values ($1)\nparams: someone@example.com,Acme') as Error & { cause?: unknown };
  e.cause = { code: "42P01", message: 'relation "waitlist" does not exist' };
  return e;
};

describe("errorText / safeStack", () => {
  it("errorText keeps the database's reason, not the parameters", () => {
    const t = errorText(failed());
    expect(t).toContain("42P01");
    expect(t).not.toContain("someone@example.com");
  });
  it("safeStack keeps call frames only, even when params is not the first line", () => {
    const e = failed();
    e.stack = `Error: Failed query: insert ...\nparams: someone@example.com,Acme,2026-11-16\n    at joinWaitlist (lib/waitlist.ts:10:5)\n    at async handle (lib/api.ts:50:7)`;
    const s = safeStack(e);
    expect(s).not.toContain("someone@example.com");
    expect(s).not.toContain("Failed query");
    expect(s.split("\n")).toHaveLength(2);
  });
  it("copes with a non-error", () => {
    expect(safeStack("boom")).toBe("");
  });
});
