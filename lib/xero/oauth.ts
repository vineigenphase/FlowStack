/**
 * Xero OAuth 2.0 (authorisation code + PKCE) and OIDC id_token checks — BACKEND.md §3.5.
 * These calls go to identity.xero.com and the /connections endpoint, never to the Accounting API.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { env, xeroScopes } from "@/lib/env";
import { ConnectionsResponse, TokenResponse, type TokenSet } from "./schemas";

export const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
export const TOKEN_URL = "https://identity.xero.com/connect/token";
export const REVOKE_URL = "https://identity.xero.com/connect/revocation";
export const CONNECTIONS_URL = "https://api.xero.com/connections";
export const ISSUER = "https://identity.xero.com";
export const JWKS_URL = "https://identity.xero.com/.well-known/openid-configuration/jwks";

const b64url = (b: Buffer) => b.toString("base64url");

export function newPkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  return { verifier, challenge, state };
}

export function authorizeUrl(p: { state: string; challenge: string }) {
  const e = env();
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", e.XERO_CLIENT_ID);
  u.searchParams.set("redirect_uri", e.XERO_REDIRECT_URI);
  u.searchParams.set("scope", xeroScopes().join(" "));
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

function basic() {
  const e = env();
  return "Basic " + Buffer.from(`${e.XERO_CLIENT_ID}:${e.XERO_CLIENT_SECRET}`).toString("base64");
}

async function tokenCall(body: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<TokenSet> {
  const r = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const text = await r.text();
  if (!r.ok) {
    // Error bodies from the identity server carry no tokens; still keep them short.
    throw new Error(`Xero token endpoint ${r.status}: ${text.slice(0, 120)}`);
  }
  return TokenResponse.parse(JSON.parse(text));
}

export function exchangeCode(code: string, verifier: string, fetchImpl?: typeof fetch) {
  return tokenCall(
    { grant_type: "authorization_code", code, redirect_uri: env().XERO_REDIRECT_URI, code_verifier: verifier },
    fetchImpl,
  );
}

export function refreshTokens(refreshToken: string, fetchImpl?: typeof fetch) {
  return tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}

export async function revokeRefreshToken(refreshToken: string, fetchImpl: typeof fetch = fetch) {
  await fetchImpl(REVOKE_URL, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  });
}

export async function listConnections(accessToken: string, fetchImpl: typeof fetch = fetch) {
  const r = await fetchImpl(CONNECTIONS_URL, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
  if (!r.ok) throw new Error(`Xero connections ${r.status}`);
  return ConnectionsResponse.parse(await r.json()).filter((c) => c.tenantType === "ORGANISATION");
}

/** Removes our app's access to one tenant. This touches the connection, not the ledger. */
export async function deleteConnection(accessToken: string, connectionId: string, fetchImpl: typeof fetch = fetch) {
  await fetchImpl(`${CONNECTIONS_URL}/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

const IdClaims = z.object({
  sub: z.string(),
  email: z.string().email(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  xero_userid: z.string().optional(),
});
export type XeroIdentity = z.infer<typeof IdClaims>;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function verifyIdToken(idToken: string, keySet?: Parameters<typeof jwtVerify>[1]): Promise<XeroIdentity> {
  if (!keySet) jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
  const { payload } = await jwtVerify(idToken, (keySet ?? jwks)!, { issuer: ISSUER, audience: env().XERO_CLIENT_ID });
  return IdClaims.parse(payload as JWTPayload);
}
