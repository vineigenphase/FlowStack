/**
 * The error text we store on a sync run and show on the page. A failed database write from drizzle carries
 * the whole SQL and its parameters in its message ("Failed query: insert ... params: ..."): the parameters are
 * ledger values, so they must never be stored or logged. Keep the database's own reason instead.
 */
type PgLike = { code?: unknown; message?: unknown; detail?: unknown; constraint_name?: unknown; constraint?: unknown };

export function errorText(e: unknown, max = 300): string {
  const err = e as { message?: unknown; cause?: unknown };
  const msg = typeof err?.message === "string" ? err.message : String(e);
  if (/^Failed query:/.test(msg)) {
    const c = (err.cause ?? {}) as PgLike;
    const parts = [
      "Couldn't save to the database",
      typeof c.code === "string" ? `(${c.code})` : "",
      typeof c.message === "string" ? `: ${c.message}` : "",
      typeof c.detail === "string" ? `. ${c.detail}` : "",
    ];
    return parts.join("").slice(0, max);
  }
  return msg.slice(0, max);
}
