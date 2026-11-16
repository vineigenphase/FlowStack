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

/**
 * The call frames of an error's stack, nothing else. A drizzle "Failed query" stack starts with the SQL and a
 * "params: …" line (ledger values, emails), and that line isn't always the first, so keep only "at …" frames.
 */
export function safeStack(e: unknown, maxFrames = 20): string {
  const raw = String((e as { stack?: unknown })?.stack ?? "");
  return raw
    .split("\n")
    .filter((l) => /^\s+at\s/.test(l))
    .slice(0, maxFrames)
    .join("\n");
}
