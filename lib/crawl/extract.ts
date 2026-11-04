/**
 * Fact extraction from vendor page text (BACKEND.md §11.3). Two extractors, both returning
 * {field, value, quote}; the crawl keeps only those whose quote passes the verbatim check.
 *  - rulesExtractor: regexes for the plainest facts (always on, free)
 *  - llmExtractor:   claude-haiku-5-5 with structured output (only when LLM_ENABLED). Vendor marketing pages
 *                    only — never ledger data — so the Xero no-training terms aren't engaged; inference only.
 */
import { z } from "zod";
import { env } from "@/lib/env";
import { FACT_FIELDS } from "@/lib/catalog/facts";

export const Extracted = z.object({ field: z.enum(FACT_FIELDS), value: z.unknown(), quote: z.string().min(4) });
export type Extracted = z.infer<typeof Extracted>;
export type Page = { kind: string; url: string; text: string };
export type Extractor = (page: Page) => Promise<Extracted[]>;

const first = (text: string, re: RegExp) => text.match(re);

export const rulesExtractor: Extractor = async ({ text }) => {
  const out: Extracted[] = [];

  // Prices: "£5 per employee per month", "from £29/month", "£4.50 per user". Keep the lowest monthly figure.
  const priceRe = /(?:from|starting at|only)?\s*£\s?(\d{1,4}(?:[.,]\d{2})?)\s*(?:\+\s*VAT\s*)?(?:per|\/|a)\s*(month|mo|user|employee|payslip|seat)\b(?:\s*(?:per|\/|a)\s*(month|mo))?/gi;
  const prices = [...text.matchAll(priceRe)].map((m) => ({ amount: Number(m[1]!.replace(",", ".")), unit: m[2]!.toLowerCase(), quote: m[0].trim() }));
  if (prices.length) {
    const low = prices.reduce((a, b) => (b.amount < a.amount ? b : a));
    out.push({ field: "price_from_gbp", value: low.amount, quote: low.quote });
    const model = ["user", "seat"].includes(low.unit) ? "per_user" : low.unit === "employee" ? "per_employee" : low.unit === "payslip" ? "per_payslip" : "flat_monthly";
    out.push({ field: "price_model", value: model, quote: low.quote });
  }

  const quoteOnly = first(text, /(contact (?:us|sales|our team) for (?:a )?(?:pricing|quote|price)|request (?:a )?(?:quote|pricing)|custom pricing)/i);
  if (quoteOnly) out.push({ field: "quote_only", value: true, quote: quoteOnly[0] });

  const setup = first(text, /(no (?:set-?up|onboarding) fees?|(?:set-?up|onboarding) fee of £\s?\d[\d,]*|£\s?\d[\d,]* (?:set-?up|onboarding) fee)/i);
  if (setup) {
    const amt = setup[0].match(/£\s?(\d[\d,]*)/);
    out.push({ field: "setup_fee", value: amt ? Number(amt[1]!.replace(/,/g, "")) : 0, quote: setup[0] });
  }

  const term = first(text, /(no (?:long-term |minimum )?contracts?|cancel any ?time|(\d{1,2})[- ]month (?:minimum )?(?:contract|term)|annual contract)/i);
  if (term) {
    const t = term[0].toLowerCase();
    const months = term[2] ? Number(term[2]) : t.includes("annual") ? 12 : 0;
    out.push({ field: "min_term", value: { months }, quote: term[0] });
  }

  const certs = [...new Set([...text.matchAll(/\b(ISO\s?27001|SOC\s?2(?: Type (?:II|2|I|1))?|Cyber Essentials(?: Plus)?)\b/gi)].map((m) => m[1]!.replace(/\s+/g, " ")))];
  if (certs.length) {
    const q = first(text, /\b(ISO\s?27001|SOC\s?2(?: Type (?:II|2|I|1))?|Cyber Essentials(?: Plus)?)\b/i)!;
    out.push({ field: "security_certs", value: certs.sort(), quote: q[0] });
  }

  const loc = first(text, /data (?:is )?(?:stored|hosted|held) (?:securely )?in (?:the )?(UK|EU|United Kingdom|Europe|US|USA|Australia)\b/i);
  if (loc) out.push({ field: "data_location", value: loc[1]!.replace(/United Kingdom/i, "UK").replace(/Europe/i, "EU").toUpperCase(), quote: loc[0] });

  const support = first(text, /(24\/7 (?:customer )?support|support (?:is )?available (?:\d{1,2}(?:am|pm)?\s*[-–]\s*\d{1,2}(?:am|pm)?|monday to friday)[^.\n]{0,40})/i);
  if (support) out.push({ field: "support_hours", value: support[0].trim(), quote: support[0].trim() });

  return out;
};

const LlmOut = z.object({
  facts: z.array(z.object({ field: z.enum(FACT_FIELDS), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]), quote: z.string() })),
});

const SYSTEM = `You extract facts about a software product from the text of the vendor's own web page.
Return only facts the page states. For each, copy the exact sentence fragment that states it into "quote" — character for character from the page. If the page doesn't state a field, leave it out. Never estimate or infer prices.
Fields: ${FACT_FIELDS.join(", ")}. price_from_gbp is the lowest monthly price in pounds as a number.`;

/** Returns null when the LLM is disabled, so callers fall back to rules only. */
export async function llmExtractor(): Promise<Extractor | null> {
  if (!env().LLM_ENABLED) return null;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const client = new Anthropic();
  return async ({ url, text }) => {
    const res = await client.messages.parse({
      model: "claude-haiku-5-5",
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(LlmOut) },
      messages: [{ role: "user", content: `Page: ${url}\n\n${text}` }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return [];
    return res.parsed_output.facts.flatMap((f) => {
      const p = Extracted.safeParse(f);
      return p.success ? [p.data] : [];
    });
  };
}
