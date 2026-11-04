import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { pingDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** DB + config check. Reports which settings are present, never their values. */
export async function GET() {
  const e = env();
  let db: "ok" | "error" = "ok";
  try {
    await pingDb();
  } catch {
    db = "error";
  }
  const config = {
    xero_mode: e.XERO_MODE,
    xero_client: Boolean(e.XERO_CLIENT_ID && e.XERO_CLIENT_SECRET),
    token_key: Buffer.from(e.TOKEN_ENC_KEY || "", "base64").length === 32,
    session_secret: e.SESSION_SECRET.length >= 32,
    llm: e.LLM_ENABLED,
    database: e.DATABASE_URL ? "postgres" : "pglite",
  };
  const ok = db === "ok";
  return NextResponse.json({ ok, db, config }, { status: ok ? 200 : 503 });
}
