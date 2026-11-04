/**
 * Supplier-name normalisation (BACKEND.md §6.3): lowercase; strip legal suffixes, punctuation, `*`,
 * "dd" and trailing reference tokens. "GOOGLE*GSUITE COPPERPOT" → "google gsuite copperpot",
 * "MSFT * E0300ABCD" → "msft", "Pleo Technologies ApS" → "pleo technologies".
 */
const LEGAL = new Set(["ltd", "limited", "inc", "llc", "plc", "pty", "gmbh", "uk", "aps", "as", "ab", "bv", "sa", "sarl", "co", "corp", "llp"]);
const NOISE = new Set(["dd", "ddr", "sto", "so", "pos", "card", "payment", "www", "com", "the"]);

export function normaliseName(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\.com\b/g, " com")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Trailing references: tokens with digits (invoice/card refs) or legal/noise words at the end.
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!;
    if (/\d/.test(last) || LEGAL.has(last) || NOISE.has(last)) tokens.pop();
    else break;
  }
  return tokens.filter((t) => !LEGAL.has(t) && t !== "dd").join(" ");
}
