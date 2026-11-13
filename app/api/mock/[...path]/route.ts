import { NextResponse } from "next/server";
import { mockResponse } from "@/lib/api/mock";

export const dynamic = "force-dynamic";

/** Mock mode only (UI-SPEC §3): NEXT_PUBLIC_API_MODE=mock, or any non-production build. 404 in production otherwise. */
const enabled = () => process.env.NEXT_PUBLIC_API_MODE === "mock" || process.env.NODE_ENV !== "production";

async function serve(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!enabled()) return NextResponse.json({ code: "NOT_FOUND", message: "Not found", retryable: false, requestId: "mock", error: "Not found" }, { status: 404 });
  const { path } = await params;
  const url = new URL(req.url);
  let body: unknown = null;
  if (req.method !== "GET" && req.method !== "HEAD") body = await req.json().catch(() => null);
  const r = mockResponse(req.method, path, url.searchParams, body);
  if (r.status === 204) return new Response(null, { status: 204 });
  return NextResponse.json(r.json, { status: r.status, headers: { "x-request-id": "mock" } });
}

export { serve as GET, serve as POST, serve as PUT, serve as DELETE };
