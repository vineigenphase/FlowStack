import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite ships WASM + data files; keep it out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "libsodium-wrappers", "pino"],
};

export default config;
