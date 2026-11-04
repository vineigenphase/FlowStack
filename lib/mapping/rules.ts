/** Rule-based account mapping (BACKEND.md §5 step 2). Pure. */
import type { AccountCategory } from "@/lib/catalog/load";

export type AccountIn = {
  xeroAccountId: string;
  code?: string | null;
  name: string;
  type: string;
  reportingCode?: string | null;
  systemAccount?: string | null;
};

export type RuleMatch = { category: string; confidence: number; ruleId: string };

export const CONF = { system: 0.95, reporting: 0.9, typeOnly: 0.9, nameTyped: 0.8, nameOnly: 0.7 } as const;

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");

/** Keyword matches at the start of a word: "rent" matches "Rent", not "Current". */
function nameHas(name: string, kw: string) {
  const n = norm(name);
  const k = norm(kw);
  let i = n.indexOf(k);
  while (i !== -1) {
    if (i === 0 || !/[a-z0-9]/.test(n[i - 1]!)) return true;
    i = n.indexOf(k, i + 1);
  }
  return false;
}

export function matchAccount(a: AccountIn, categories: AccountCategory[]): RuleMatch | null {
  let best: RuleMatch | null = null;
  const consider = (category: string, confidence: number, how: string) => {
    if (!best || confidence > best.confidence) best = { category, confidence, ruleId: `${category}:${how}` };
  };
  const type = (a.type || "").toUpperCase();

  for (const c of categories) {
    const m = c.match;
    const typeOk = m.types.length === 0 ? null : m.types.includes(type);
    if (typeOk === false) continue;
    if (m.system_account && a.systemAccount && m.system_account === a.systemAccount.toUpperCase()) consider(c.key, CONF.system, "system");
    if (typeOk && a.reportingCode && m.reporting_codes.some((rc) => a.reportingCode!.toUpperCase().startsWith(rc.toUpperCase())))
      consider(c.key, CONF.reporting, "reporting_code");
    if (typeOk && m.type_only) consider(c.key, CONF.typeOnly, "type");
    if (m.name_any.some((kw) => nameHas(a.name, kw))) consider(c.key, typeOk ? CONF.nameTyped : CONF.nameOnly, "name");
  }
  return best;
}
