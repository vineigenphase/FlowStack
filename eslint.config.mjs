import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", ".next-e2e/**", ".e2e-results/**", ".pglite-e2e/**", "node_modules/**", ".pglite/**", "db/migrations/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTs,
];
export default config;
