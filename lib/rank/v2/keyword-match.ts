/**
 * ENGINE-V2 §1.2 keyword_match: BM25 between the rule's keywords and each candidate's description, over the
 * candidate set for the line, scaled 0–1 by the top score in the set. Stop-words removed. No embeddings, no AI.
 * No description → missing. A rule with no keywords → missing for every app.
 */
import type { ScoringV2 } from "@/lib/catalog/load";
import { missingInput, type Input } from "./part";

const STOP = new Set(
  "a an and are as at be by for from has have in into is it its of on or our that the their them this to was we will with you your can all any more most up out so than then there these they who what when which while xero app apps".split(" "),
);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9-]+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const K1 = 1.2;
const B = 0.75;

/** Raw BM25 score per document id for the query terms. Pure. */
export function bm25(query: string[], docs: Map<string, string>): Map<string, number> {
  const tok = new Map([...docs].map(([id, d]) => [id, tokens(d)]));
  const N = tok.size;
  const avg = N ? [...tok.values()].reduce((a, t) => a + t.length, 0) / N : 0;
  const q = [...new Set(query.flatMap((k) => tokens(k)))];
  const df = new Map(q.map((t) => [t, [...tok.values()].filter((d) => d.includes(t)).length]));
  const out = new Map<string, number>();
  for (const [id, d] of tok) {
    let score = 0;
    for (const t of q) {
      const f = d.filter((x) => x === t).length;
      if (!f) continue;
      const n = df.get(t)!;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / (avg || 1))));
    }
    out.set(id, score);
  }
  return out;
}

/** keyword_match for every app in the set: id → Input. */
export function keywordMatch(keywords: string[], descriptions: Map<string, string | null>, s: ScoringV2): Map<string, Input> {
  const out = new Map<string, Input>();
  const docs = new Map([...descriptions].filter((e): e is [string, string] => !!e[1]));
  const scores = keywords.length ? bm25(keywords, docs) : new Map<string, number>();
  const top = Math.max(0, ...scores.values());
  const terms = [...new Set(keywords.flatMap((k) => tokens(k)))];
  for (const [id, d] of descriptions) {
    if (!keywords.length) out.set(id, missingInput(s.neutral, "This rule has no keywords yet"));
    else if (!d) out.set(id, missingInput(s.neutral, "No description"));
    else {
      const raw = scores.get(id) ?? 0;
      const words = new Set(tokens(d));
      const hits = terms.filter((t) => words.has(t));
      out.set(id, { raw: { bm25: Math.round(raw * 1000) / 1000, top: Math.round(top * 1000) / 1000, words: hits }, normalised: top > 0 ? raw / top : 0, missing: false, note: hits.length ? `Description mentions: ${hits.join(", ")}` : "Description mentions none of the rule's keywords" });
    }
  }
  return out;
}
