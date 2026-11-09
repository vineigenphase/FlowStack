import { NextResponse } from "next/server";
import { z } from "zod";
import { log } from "@/lib/log";
import { errorText } from "@/lib/sync/error-text";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Wrap a route handler: typed errors → JSON, Zod errors → 400, anything else → 500 without internals. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      if (e instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", details: e.issues }, { status: 400 });
      // errorText drops SQL parameters (ledger values); the stack's first line repeats the message, so skip it.
      const stack = String((e as Error).stack ?? "").split("\n").slice(1).join("\n");
      log.error({ err: { message: errorText(e, 1000), stack } }, "route error");
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
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
