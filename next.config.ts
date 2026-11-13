import type { NextConfig } from "next";

const config: NextConfig = {
  // e2e runs its own dev server alongside a normal one; keep their build folders apart.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // PGlite ships WASM + data files; keep these out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "libsodium-wrappers", "pino"],
  // Read from disk at runtime (fs + process.cwd()), so the bundler can't see them: ship them explicitly.
  outputFileTracingIncludes: {
    "/api/**": ["./catalog/**/*.yaml"],
    "/app/**": ["./catalog/**/*.yaml", "./mocks/**/*.json"],
    // Fixture mode on a preview deployment (XERO_MODE=fixtures).
    "/api/orgs/**": ["./fixtures/xero/**/*.json"],
    // Front-end mock mode (NEXT_PUBLIC_API_MODE=mock, UI-SPEC §3).
    "/api/mock/**": ["./mocks/**/*.json"],
  },
};

export default config;
