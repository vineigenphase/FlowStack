/**
 * Quote check (BACKEND.md §11.4): a fact is kept only if its quote appears verbatim in the page text,
 * after folding whitespace, case and typographic punctuation. No quote match, no fact.
 */
export function normaliseText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function quoteFound(quote: string | null | undefined, pageText: string): boolean {
  if (!quote) return false;
  const q = normaliseText(quote);
  return q.length >= 4 && normaliseText(pageText).includes(q);
}
