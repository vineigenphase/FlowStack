/**
 * Server-side reads for server components (UI-SPEC §3). Same data as the API routes, without an HTTP hop:
 * membership is checked, then the contract read model runs. With NEXT_PUBLIC_API_MODE=mock the mocks answer
 * instead (pass the page's `scenario` search param through).
 *
 * Errors throw HttpError (status + contract code), which pages turn into ErrorState / notFound().
 */
import { HttpError } from "@/lib/api";
import { getSession, requireOrgMember, requireUser } from "@/lib/auth/session";
import * as C from "./contract";
import { mockResponse } from "./mock";
import type * as T from "./types";

const MOCK = () => process.env.NEXT_PUBLIC_API_MODE === "mock";

function mock<R>(path: string, scenario?: string): R {
  const [p, q] = path.split("?");
  const query = new URLSearchParams(q ?? "");
  if (scenario) query.set("scenario", scenario);
  const r = mockResponse("GET", p!.split("/").filter(Boolean), query, null);
  if (r.status >= 400) {
    const e = r.json as T.ApiError;
    throw new HttpError(r.status, e.message, undefined, e.code);
  }
  return r.json as R;
}

const need = <R>(v: R | null, what: string): R => {
  if (v === null) throw new HttpError(404, what);
  return v;
};

export const server = {
  async me(scenario?: string): Promise<T.Me> {
    if (MOCK()) return mock("/me", scenario);
    const u = await requireUser();
    const s = await getSession();
    return need(await C.me(u.userId, s.activeOrgId ?? null), "Sign in with Xero first");
  },
  async summary(org: string, scenario?: string): Promise<T.Summary> {
    if (MOCK()) return mock(`/orgs/${org}/summary`, scenario);
    await requireOrgMember(org);
    return need(await C.summary(org), "Org not found");
  },
  async statement(org: string, kind: T.StatementKind, months?: 12, scenario?: string): Promise<T.Statement> {
    if (MOCK()) return mock(`/orgs/${org}/statements/${kind}${months ? "?months=12" : ""}`, scenario);
    await requireOrgMember(org);
    return need(await C.statement(org, kind, { months }), "No statements yet. Run a refresh first.");
  },
  async line(org: string, lineKey: string, scenario?: string): Promise<T.LineDetail> {
    if (MOCK()) return mock(`/orgs/${org}/lines/${encodeURIComponent(lineKey)}`, scenario);
    await requireOrgMember(org);
    return need(await C.lineDetail(org, lineKey), "Line not found");
  },
  async detectedApps(org: string, scenario?: string) {
    if (MOCK()) return mock<{ apps: T.DetectedApp[]; questions: T.LifecycleQuestion[] }>(`/orgs/${org}/detected-apps`, scenario);
    await requireOrgMember(org);
    return C.detectedAppsView(org);
  },
  async essentials(org: string, scenario?: string): Promise<T.Essential[]> {
    if (MOCK()) return mock(`/orgs/${org}/essentials`, scenario);
    await requireOrgMember(org);
    return C.essentialsOf(org);
  },
  async shortlist(org: string, scenario?: string): Promise<T.ShortlistItem[]> {
    if (MOCK()) return mock(`/orgs/${org}/shortlist`, scenario);
    await requireOrgMember(org);
    return C.shortlistOf(org);
  },
  async settings(org: string, scenario?: string): Promise<T.OrgSettings> {
    if (MOCK()) return mock(`/orgs/${org}/settings`, scenario);
    await requireOrgMember(org);
    return need(await C.settingsOf(org), "Org not found");
  },
  async run(org: string, runId: string, scenario?: string): Promise<T.RefreshRun> {
    if (MOCK()) return mock(`/orgs/${org}/refresh/${runId}`, scenario);
    await requireOrgMember(org);
    return need(await C.refreshRun(org, runId), "Run not found");
  },
  async apps(f: { category?: string; market?: string; q?: string } = {}, scenario?: string): Promise<T.AppCard[]> {
    if (MOCK()) {
      const p = new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => Boolean(e[1])));
      return mock(`/apps${p.size ? `?${p}` : ""}`, scenario);
    }
    return C.appCards(f);
  },
  async app(id: string, org?: string, scenario?: string): Promise<T.AppDossier> {
    if (MOCK()) return mock(`/apps/${id}`, scenario);
    if (org) await requireOrgMember(org);
    return need(await C.dossier(id, org), "App not found");
  },
  async plans(scenario?: string): Promise<T.Plan[]> {
    if (MOCK()) return mock("/billing/plans", scenario);
    return C.plansView();
  },
  async subscription(org: string, scenario?: string): Promise<T.Subscription> {
    if (MOCK()) return mock(`/orgs/${org}/subscription`, scenario);
    await requireOrgMember(org);
    return C.subscriptionOf(org);
  },
};
