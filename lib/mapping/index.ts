/**
 * Account mapping pipeline (BACKEND.md §5): confirmed → rules → LLM (optional) → unmapped + review queue.
 * Lines on unmapped accounts are never flagged.
 */
import type { AccountCategory } from "@/lib/catalog/load";
import { matchAccount, type AccountIn } from "./rules";

export type MapSource = "rule" | "llm" | "confirmed";
export type AccountMap = {
  xeroAccountId: string;
  category: string; // "unmapped" when below the bar
  confidence: number;
  source: MapSource;
  ruleId: string | null;
};

export type LlmSuggest = (accounts: { name: string; type: string }[], categories: string[]) => Promise<({ category: string; confidence: number } | null)[]>;

export const UNMAPPED = "unmapped";
export const LLM_CAP = 0.8;

export async function mapAccounts(opts: {
  accounts: AccountIn[];
  categories: AccountCategory[];
  confirmed: Map<string, string>; // xeroAccountId → category
  minConfidence: number;
  llm?: LlmSuggest;
}): Promise<{ maps: AccountMap[]; unmapped: AccountIn[] }> {
  const { accounts, categories, confirmed, minConfidence, llm } = opts;
  const known = new Set(categories.map((c) => c.key));
  const out = new Map<string, AccountMap>();
  const pending: AccountIn[] = [];

  for (const a of accounts) {
    const conf = confirmed.get(a.xeroAccountId);
    if (conf && known.has(conf)) {
      out.set(a.xeroAccountId, { xeroAccountId: a.xeroAccountId, category: conf, confidence: 1, source: "confirmed", ruleId: null });
      continue;
    }
    const m = matchAccount(a, categories);
    if (m && m.confidence >= minConfidence) {
      out.set(a.xeroAccountId, { xeroAccountId: a.xeroAccountId, category: m.category, confidence: m.confidence, source: "rule", ruleId: m.ruleId });
    } else {
      pending.push(a);
      out.set(a.xeroAccountId, {
        xeroAccountId: a.xeroAccountId,
        category: UNMAPPED,
        confidence: m?.confidence ?? 0,
        source: "rule",
        ruleId: m?.ruleId ?? null,
      });
    }
  }

  if (llm && pending.length) {
    // Names and types only: no amounts, no org name (BACKEND.md §5.3, §17).
    const suggestions = await llm(
      pending.map((a) => ({ name: a.name, type: a.type })),
      [...known],
    );
    pending.forEach((a, i) => {
      const s = suggestions[i];
      if (!s || !known.has(s.category)) return;
      const confidence = Math.min(LLM_CAP, s.confidence);
      if (confidence >= minConfidence) {
        out.set(a.xeroAccountId, { xeroAccountId: a.xeroAccountId, category: s.category, confidence, source: "llm", ruleId: null });
      }
    });
  }

  const maps = accounts.map((a) => out.get(a.xeroAccountId)!);
  const unmapped = accounts.filter((a) => out.get(a.xeroAccountId)!.category === UNMAPPED);
  return { maps, unmapped };
}
