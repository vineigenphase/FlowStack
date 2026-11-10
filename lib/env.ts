import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const num = (d: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? d : Number(v)))
    .pipe(z.number().finite());

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional().default(""),
  DATABASE_ADMIN_URL: z.string().optional().default(""),
  PGLITE_DIR: z.string().default(".pglite"),
  XERO_MODE: z.enum(["live", "fixtures"]).default("fixtures"),
  XERO_FIXTURE_SET: z.string().default("demo-uk-synthetic"),
  XERO_CLIENT_ID: z.string().optional().default(""),
  XERO_CLIENT_SECRET: z.string().optional().default(""),
  XERO_REDIRECT_URI: z.string().default("http://localhost:3000/api/auth/xero/callback"),
  XERO_SCOPES: z
    .string()
    .default(
      "openid profile email offline_access accounting.settings.read accounting.contacts.read accounting.reports.profitandloss.read accounting.reports.balancesheet.read accounting.reports.trialbalance.read accounting.reports.aged.read accounting.invoices.read accounting.banktransactions.read",
    ),
  TOKEN_ENC_KEY: z.string().optional().default(""),
  SESSION_SECRET: z.string().optional().default(""),
  ADMIN_EMAILS: z.string().default(""),
  LLM_ENABLED: bool,
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  TAVILY_API_KEY: z.string().optional().default(""),
  CRON_SECRET: z.string().optional().default(""),
  SENTRY_DSN: z.string().optional().default(""),
  HIGH_BAND: num(0.1),
  MED_BAND: num(0.02),
  MAP_CONFIDENCE_MIN: num(0.75),
  FP_GATE: num(0.15),
  /** v1.1 G: peer price ranges are OPEN (CHANGES-v1.1.md §4 item 2: lawyer + Xero partner sign-off). Off: nothing is collected or shown. */
  PEER_PRICES_ENABLED: bool,
  /** v1.1 H: the Monday digest is parked until firms connect many clients. */
  MONDAY_DIGEST_ENABLED: bool,
  /** v1.1 I: Xero plan connection cap (Starter 5, Core 50). */
  XERO_CONNECTION_CAP: num(5),
  /** v1.1 E: Stripe, test mode only until prices are decided (CHANGES-v1.1.md §4 item 1). */
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  STRIPE_PRICE_IDS_JSON: z.string().optional().default(""),
  /** v1.1 L: Companies House public data API. */
  COMPANIES_HOUSE_API_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parsed environment. Re-read with `resetEnv()` in tests. */
export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

/**
 * Settings a deployed environment can't run without. PGlite is a dev convenience: on Vercel the filesystem is
 * read-only and per-instance, so a real DATABASE_URL is required. Returns the names that are missing.
 */
export function missingForDeploy(e: Env = env()): string[] {
  const missing: string[] = [];
  if (!e.DATABASE_URL) missing.push("DATABASE_URL");
  if (Buffer.from(e.TOKEN_ENC_KEY || "", "base64").length !== 32) missing.push("TOKEN_ENC_KEY");
  if (e.SESSION_SECRET.length < 32) missing.push("SESSION_SECRET");
  if (e.CRON_SECRET.length < 16) missing.push("CRON_SECRET");
  if (e.XERO_MODE === "live" && !(e.XERO_CLIENT_ID && e.XERO_CLIENT_SECRET)) missing.push("XERO_CLIENT_ID/XERO_CLIENT_SECRET");
  if (!/^https:\/\//.test(e.APP_URL)) missing.push("APP_URL (https)");
  return missing;
}

export const isDeployed = () => Boolean(process.env.VERCEL);

export function resetEnv() {
  cached = null;
}

export function adminEmails(): string[] {
  return env()
    .ADMIN_EMAILS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Scopes we request; guarded so a write scope can never slip in. */
export function xeroScopes(): string[] {
  const scopes = env().XERO_SCOPES.split(/\s+/).filter(Boolean);
  const allowed = new Set(["openid", "profile", "email", "offline_access"]);
  for (const s of scopes) {
    if (!allowed.has(s) && !s.endsWith(".read")) {
      throw new Error(`Refusing non-read Xero scope: ${s}`);
    }
  }
  return scopes;
}
