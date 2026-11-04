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
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parsed environment. Re-read with `resetEnv()` in tests. */
export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

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
