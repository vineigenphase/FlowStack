import { NextResponse } from "next/server";
import { z } from "zod";
import { log } from "@/lib/log";

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
      log.error({ err: { message: (e as Error).message, stack: (e as Error).stack } }, "route error");
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
