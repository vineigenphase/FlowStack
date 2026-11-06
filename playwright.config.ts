import { defineConfig } from "@playwright/test";

/**
 * End-to-end: connect (dev sign-in on fixtures) → diagnosis → recommendations → stack map, plus the
 * CLAUDE.md §10 "works in both themes at 400px" check.
 *
 * Runs against a throwaway embedded database (.pglite-e2e), never Neon: every database variable that
 * .env.local could supply is overridden below, because Next and our scripts only fill unset variables.
 * Uses the installed Chrome (channel "chrome"), so no browser download is needed.
 */
const PORT = 3005;
const DB = "pglite:.pglite-e2e";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: ".e2e-results",
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", headless: true, trace: "retain-on-failure" },
  webServer: {
    command: `node -e "require('fs').rmSync('.pglite-e2e',{recursive:true,force:true})" && pnpm db:migrate && pnpm db:seed --demo-org && pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: DB,
      DATABASE_ADMIN_URL: DB,
      DATABASE_URL_UNPOOLED: DB,
      NEON_BRANCH: "e2e",
      XERO_MODE: "fixtures",
      XERO_CLIENT_ID: "",
      XERO_CLIENT_SECRET: "",
      LLM_ENABLED: "false",
      ANTHROPIC_API_KEY: "",
      TAVILY_API_KEY: "",
      APP_URL: `http://localhost:${PORT}`,
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
