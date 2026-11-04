import { afterEach, describe, expect, it } from "vitest";
import { missingForDeploy, resetEnv, env } from "@/lib/env";
import { requireCron } from "@/lib/cron";
import { HttpError } from "@/lib/api";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnv();
});

describe("missingForDeploy", () => {
  it("names every setting a deployed environment can't run without", () => {
    process.env = { NODE_ENV: "production", XERO_MODE: "live" } as NodeJS.ProcessEnv;
    resetEnv();
    expect(missingForDeploy(env())).toEqual(["DATABASE_URL", "TOKEN_ENC_KEY", "SESSION_SECRET", "CRON_SECRET", "XERO_CLIENT_ID/XERO_CLIENT_SECRET", "APP_URL (https)"]);
  });
  it("passes with a complete set", () => {
    process.env = {
      NODE_ENV: "production",
      XERO_MODE: "live",
      DATABASE_URL: "postgres://u:p@h/db",
      TOKEN_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
      SESSION_SECRET: "x".repeat(48),
      CRON_SECRET: "y".repeat(32),
      XERO_CLIENT_ID: "id",
      XERO_CLIENT_SECRET: "secret",
      APP_URL: "https://flowstack.example",
    } as NodeJS.ProcessEnv;
    resetEnv();
    expect(missingForDeploy(env())).toEqual([]);
  });
});

describe("requireCron", () => {
  const req = (auth?: string) => new Request("https://x/api/cron/nightly", { headers: auth ? { authorization: auth } : {} });
  it("accepts only Bearer CRON_SECRET", () => {
    process.env.CRON_SECRET = "s".repeat(32);
    resetEnv();
    expect(() => requireCron(req(`Bearer ${"s".repeat(32)}`))).not.toThrow();
    expect(() => requireCron(req("Bearer wrong"))).toThrow(HttpError);
    expect(() => requireCron(req())).toThrow(HttpError);
  });
  it("refuses everything when CRON_SECRET is unset or short", () => {
    process.env.CRON_SECRET = "";
    resetEnv();
    expect(() => requireCron(req("Bearer "))).toThrow(HttpError);
  });
});
