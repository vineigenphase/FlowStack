/**
 * Browser-side API client (UI-SPEC §3): typed calls for client components. With NEXT_PUBLIC_API_MODE=mock every
 * call goes to /api/mock/* and carries the page's ?scenario= through. Errors throw ApiClientError with the
 * spec's ApiError (message, retryable, requestId) so ErrorState can show them.
 */
import type * as T from "./types";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public error: T.ApiError,
  ) {
    super(error.message);
  }
}

export const MOCK_MODE = process.env.NEXT_PUBLIC_API_MODE === "mock";

function urlOf(path: string): string {
  let u = (MOCK_MODE ? "/api/mock" : "/api") + path;
  if (MOCK_MODE && typeof window !== "undefined") {
    const sc = new URLSearchParams(window.location.search).get("scenario");
    if (sc) u += `${u.includes("?") ? "&" : "?"}scenario=${encodeURIComponent(sc)}`;
  }
  return u;
}

export async function api<R>(path: string, init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {}): Promise<R> {
  let res: Response;
  try {
    res = await fetch(urlOf(path), {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError(0, { code: "INTERNAL", message: "Couldn't reach FlowStack. Check your connection and try again.", retryable: true, requestId: "offline" });
  }
  if (res.status === 204) return undefined as R;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (json ?? {}) as Partial<T.ApiError>;
    throw new ApiClientError(res.status, {
      code: e.code ?? "INTERNAL",
      message: e.message ?? `Something went wrong (HTTP ${res.status}).`,
      retryable: e.retryable ?? res.status >= 500,
      requestId: e.requestId ?? res.headers.get("x-request-id") ?? "unknown",
    });
  }
  return json as R;
}

const o = (org: string) => `/orgs/${encodeURIComponent(org)}`;
const qs = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1])));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** One function per endpoint in UI-SPEC §8. */
export const client = {
  me: () => api<T.Me>("/me"),
  setJobTitle: (jobTitle: string) => api<T.Me>("/me", { method: "PUT", body: { jobTitle } }),
  setActiveOrg: (orgId: string) => api<T.Me>("/me/active-org", { method: "POST", body: { orgId } }),
  settings: (org: string) => api<T.OrgSettings>(`${o(org)}/settings`),
  saveSettings: (org: string, s: T.OrgSettings) => api<T.OrgSettings>(`${o(org)}/settings`, { method: "PUT", body: s }),
  refresh: (org: string) => api<T.RefreshRun>(`${o(org)}/refresh`, { method: "POST" }),
  run: (org: string, runId: string) => api<T.RefreshRun>(`${o(org)}/refresh/${encodeURIComponent(runId)}`),
  summary: (org: string) => api<T.Summary>(`${o(org)}/summary`),
  statement: (org: string, kind: T.StatementKind, months?: 12) => api<T.Statement>(`${o(org)}/statements/${kind}${months ? `?months=${months}` : ""}`),
  line: (org: string, lineKey: string) => api<T.LineDetail>(`${o(org)}/lines/${encodeURIComponent(lineKey)}`),
  feedback: (flagId: string, input: T.FeedbackInput) => api<T.FeedbackResult>(`/flags/${flagId}/feedback`, { method: "POST", body: input }),
  undoFeedback: (flagId: string) => api<{ line: T.Line; message: string }>(`/flags/${flagId}/feedback`, { method: "DELETE" }),
  detectedApps: (org: string) => api<{ apps: T.DetectedApp[]; questions: T.LifecycleQuestion[] }>(`${o(org)}/detected-apps`),
  answerApp: (org: string, appId: string, a: T.LifecycleAnswer & { replacementAppId?: string }) =>
    api<{ apps: T.DetectedApp[]; questions: T.LifecycleQuestion[] }>(`${o(org)}/detected-apps/${encodeURIComponent(appId)}/answer`, { method: "POST", body: a }),
  declareApp: (org: string, a: { appId?: string; name?: string }) => api<{ apps: T.DetectedApp[]; questions: T.LifecycleQuestion[] }>(`${o(org)}/detected-apps/declare`, { method: "POST", body: a }),
  essentials: (org: string) => api<T.Essential[]>(`${o(org)}/essentials`),
  setEssential: (org: string, key: string, covered: boolean) => api<T.Essential[]>(`${o(org)}/essentials`, { method: "PUT", body: { key, covered } }),
  shortlist: (org: string) => api<T.ShortlistItem[]>(`${o(org)}/shortlist`),
  addToShortlist: (org: string, appId: string, lineKey?: string) => api<T.ShortlistItem[]>(`${o(org)}/shortlist`, { method: "POST", body: { appId, lineKey } }),
  removeFromShortlist: (org: string, appId: string, lineKey?: string) => api<T.ShortlistItem[]>(`${o(org)}/shortlist`, { method: "DELETE", body: { appId, lineKey } }),
  apps: (f: { category?: string; market?: string; q?: string } = {}) => api<T.AppCard[]>(`/apps${qs(f)}`),
  app: (id: string, org?: string) => api<T.AppDossier>(`/apps/${encodeURIComponent(id)}${qs({ org })}`),
  plans: () => api<T.Plan[]>("/billing/plans"),
  subscription: (org: string) => api<T.Subscription>(`${o(org)}/subscription`),
  checkout: (orgId: string, planId: T.Plan["id"]) => api<{ url: string }>("/billing/checkout", { method: "POST", body: { orgId, planId } }),
  portal: (orgId: string) => api<{ url: string }>("/billing/portal", { method: "POST", body: { orgId } }),
  waitlist: (w: { email: string; name: string; company: string; role: string; industry: T.Industry; consent: true }) => api<{ ok: true }>("/waitlist", { method: "POST", body: w }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
  disconnect: (org: string) => api<void>(`${o(org)}/disconnect`, { method: "POST" }),
};
