import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite ships WASM + data files; keep these out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "libsodium-wrappers", "pino"],
  // Read from disk at runtime (fs + process.cwd()), so the bundler can't see them: ship them explicitly.
  outputFileTracingIncludes: {
    "/api/**": ["./catalog/**/*.yaml"],
    "/app/**": ["./catalog/**/*.yaml"],
    // Fixture mode on a preview deployment (XERO_MODE=fixtures).
    "/api/orgs/**": ["./fixtures/xero/**/*.json"],
  },
};

export default config;
