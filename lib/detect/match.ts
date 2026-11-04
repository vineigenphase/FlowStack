/**
 * Fingerprint matching (BACKEND.md §6.4): exact → alias (token prefix) → fuzzy (Jaro-Winkler).
 * Fuzzy ≥ 0.97 counts as detected; 0.93–0.97 goes to the review queue as fingerprint_check.
 */
export type Fingerprint = { appId: string; pattern: string };
export type MatchKind = "exact" | "alias" | "fuzzy" | "fuzzy_check";
export type Match = { appId: string; kind: MatchKind; score: number; pattern: string };

export const FUZZY_MIN = 0.93;
export const FUZZY_STRONG = 0.97;

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      m++;
      break;
    }
  }
  if (!m) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

const isPrefix = (p: string) => p.endsWith(" *");
const stem = (p: string) => (isPrefix(p) ? p.slice(0, -2) : p);

export function matchSupplier(nameNorm: string, fps: Fingerprint[]): Match | null {
  if (!nameNorm) return null;
  for (const f of fps) if (!isPrefix(f.pattern) && f.pattern === nameNorm) return { appId: f.appId, kind: "exact", score: 1, pattern: f.pattern };
  for (const f of fps) {
    if (!isPrefix(f.pattern)) continue;
    const s = stem(f.pattern);
    if (nameNorm === s || nameNorm.startsWith(s + " ")) return { appId: f.appId, kind: "alias", score: 1, pattern: f.pattern };
  }
  // Fuzzy: compare against each pattern stem, and against the same number of leading tokens of the name.
  let best: Match | null = null;
  const tokens = nameNorm.split(" ");
  for (const f of fps) {
    const s = stem(f.pattern);
    if (s.length < 4) continue; // too short to fuzz safely
    const n = s.split(" ").length;
    const lead = tokens.slice(0, n).join(" ");
    const score = Math.max(jaroWinkler(nameNorm, s), isPrefix(f.pattern) ? jaroWinkler(lead, s) : 0);
    if (score >= FUZZY_MIN && (!best || score > best.score)) {
      best = { appId: f.appId, kind: score >= FUZZY_STRONG ? "fuzzy" : "fuzzy_check", score: Math.round(score * 1000) / 1000, pattern: f.pattern };
    }
  }
  return best;
}
