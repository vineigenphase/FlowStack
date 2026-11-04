/** Normalise `db.execute()` results across drivers (PGlite returns {rows}, postgres-js returns an array). */
export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object" && "rows" in res) return (res as { rows: T[] }).rows;
  return [];
}
