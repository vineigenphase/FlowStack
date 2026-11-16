import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { log } from "@/lib/log";
import { errorText, safeStack } from "@/lib/sync/error-text";
import type { ApiError, ErrorCode } from "@/lib/api/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    /** UI-SPEC §8 error code; defaults from the status (codeFor). */
    public code?: ErrorCode,
  ) {
    super(message);
  }
}

/** Default contract code per HTTP status (UI-SPEC §8). */
export function codeFor(status: number): ErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 402) return "BILLING_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404 || status === 410) return "NOT_FOUND";
  if (status === 429) return "XERO_RATE_LIMITED";
  if (status === 503) return "XERO_UNAVAILABLE";
  if (status >= 500) return "INTERNAL";
  return "VALIDATION";
}

/**
 * Error body: the UI-SPEC ApiError fields plus `error` (same text as `message`) for components written before it.
 * requestId is also the x-request-id header and is logged with server errors, so a bug report can quote it.
 */
function errorResponse(status: number, e: { message: string; code?: ErrorCode; details?: unknown }, requestId: string): Response {
  const code = e.code ?? codeFor(status);
  const retryable = status >= 500 || status === 429 || code === "REFRESH_IN_PROGRESS";
  const out: ApiError & { error: string; details?: unknown } = { code, message: e.message, retryable, requestId, error: e.message };
  if (e.details !== undefined) out.details = e.details;
  return NextResponse.json(out, { status, headers: { "x-request-id": requestId } });
}

/** Wrap a route handler: typed errors → JSON, Zod errors → 400, anything else → 500 without internals. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A): Promise<Response> => {
    const requestId = randomUUID().slice(0, 13);
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e.status, e, requestId);
      if (e instanceof z.ZodError) return errorResponse(400, { message: "Invalid request", details: e.issues }, requestId);
      // errorText drops SQL parameters (ledger values, emails); safeStack keeps only call frames for the same reason.
      const stack = safeStack(e);
      log.error({ requestId, err: { message: errorText(e, 1000), stack } }, "route error");
      return errorResponse(500, { message: "Something went wrong" }, requestId);
    }
  };
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  return schema.parse(json);
}

export type Params<T> = { params: Promise<T> };
