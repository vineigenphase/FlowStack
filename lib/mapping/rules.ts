/**
 * Rule-based account mapping (BACKEND.md §5, v1.1 M). Pure.
 *
 * Order, highest confidence wins (ties keep the earlier match):
 *   system account                         0.95
 *   reporting code (catalog/reporting-codes.yaml, longest prefix)  0.90   ← the tagging leads, ahead of names
 *   category reporting_codes / type_only   0.90   (type_only: the type is decisive, e.g. BANK)
 *   name keyword or synonym + type allowed 0.80
 *   type_default (e.g. any DIRECTCOSTS → cost of sales)  0.76   ← a generic type never beats a specific name
 *   name keyword, no types listed          0.70
 * Then tax-rate checks: a category whose expected tax disagrees with the account's TaxType loses 0.15; a wages-like
 * account carrying VAT is probably agency or contractor labour → contractors at ≤ 0.70 (queued for a person).
 */
import type { AccountCategory } from "@/lib/catalog/load";

export type AccountIn = {
  xeroAccountId: string;
  code?: string | null;
  name: string;
  type: string;
  reportingCode?: string | null;
  taxType?: string | null;
  systemAccount?: string | null;
};

export type RuleMatch = { category: string; confidence: number; ruleId: string };
export type MappingCatalog = { reportingCodes: Record<string, string>; synonyms: Record<string, string[]> };

export const CONF = { system: 0.95, reporting: 0.9, typeOnly: 0.9, typeDefault: 0.76, nameTyped: 0.8, nameOnly: 0.7, taxMismatch: 0.15, vatOnWages: 0.7 } as const;

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

/**
 * Xero tax type → VAT treatment. UK expense types: INPUT2 (20%), RRINPUT (5%) carry VAT; NONE, EXEMPT*, ZERORATED*
 * don't. Anything else (reverse charge, overseas, other countries) → unknown, so no adjustment.
 */
export function taxClass(taxType: string | null | undefined): "vat" | "no_vat" | null {
  if (!taxType) return null;
  const t = taxType.toUpperCase();
  if (t === "NONE" || t.startsWith("EXEMPT") || t.startsWith("ZERORATED")) return "no_vat";
  if (["INPUT2", "RRINPUT", "INPUT", "OUTPUT2", "RROUTPUT", "OUTPUT"].includes(t)) return "vat";
  return null;
}

/** Longest reporting-code prefix in the map ("EXP.STF.WAG.X" → EXP.STF.WAG), matched on whole segments. */
function byReportingCode(code: string | null | undefined, map: Record<string, string>): string | null {
  if (!code) return null;
  const parts = code.toUpperCase().split(".");
  for (let n = parts.length; n > 0; n--) {
    const hit = map[parts.slice(0, n).join(".")];
    if (hit) return hit;
  }
  return null;
}

export function matchAccount(a: AccountIn, categories: AccountCategory[], catalog?: MappingCatalog): RuleMatch | null {
  let best: RuleMatch | null = null;
  const consider = (category: string, confidence: number, how: string) => {
    if (!best || confidence > best.confidence) best = { category, confidence, ruleId: `${category}:${how}` };
  };
  const type = (a.type || "").toUpperCase();
  const byKey = new Map(categories.map((c) => [c.key, c]));
  const typeAllowed = (c: AccountCategory) => c.match.types.length === 0 || c.match.types.includes(type);

  // System accounts are Xero's own (Accounts Receivable, VAT...): the most certain signal.
  for (const c of categories) {
    if (c.match.system_account && a.systemAccount && c.match.system_account === a.systemAccount.toUpperCase() && typeAllowed(c)) consider(c.key, CONF.system, "system");
  }
  // The tagging, from Xero's standard list, ahead of anything the business typed.
  const rc = byReportingCode(a.reportingCode, catalog?.reportingCodes ?? {});
  if (rc && byKey.has(rc) && typeAllowed(byKey.get(rc)!)) consider(rc, CONF.reporting, "reporting_code");

  for (const c of categories) {
    const m = c.match;
    const typeOk = m.types.length === 0 ? null : m.types.includes(type);
    if (typeOk === false) continue;
    if (typeOk && a.reportingCode && m.reporting_codes.some((code) => a.reportingCode!.toUpperCase().startsWith(code.toUpperCase())))
      consider(c.key, CONF.reporting, "reporting_code");
    if (typeOk && m.type_only) consider(c.key, CONF.typeOnly, "type");
    if (typeOk && m.type_default) consider(c.key, CONF.typeDefault, "type_default");
    const words = [...m.name_any, ...(catalog?.synonyms[c.key] ?? [])];
    if (words.some((kw) => nameHas(a.name, kw))) consider(c.key, typeOk ? CONF.nameTyped : CONF.nameOnly, "name");
  }

  const found = best as RuleMatch | null;
  if (!found) return null;
  const tax = taxClass(a.taxType);
  const cat = byKey.get(found.category);
  // Wages normally carry no VAT. Wages-like with 20% VAT: probably agency staff or contractors invoiced with VAT.
  if (found.category === "wages" && tax === "vat" && byKey.has("contractors")) {
    // Named as agency/contractors too ("Agency Labour"): that's what it is, at its normal confidence.
    const contractors = byKey.get("contractors")!;
    const words = [...contractors.match.name_any, ...(catalog?.synonyms.contractors ?? [])];
    if (words.some((kw) => nameHas(a.name, kw)) && typeAllowed(contractors)) return { category: "contractors", confidence: CONF.nameTyped, ruleId: "contractors:name+vat" };
    return { category: "contractors", confidence: Math.min(CONF.vatOnWages, found.confidence), ruleId: "contractors:vat_on_wages" };
  }
  if (cat?.expected_tax && tax && tax !== cat.expected_tax) {
    return { ...found, confidence: Math.round((found.confidence - CONF.taxMismatch) * 100) / 100, ruleId: `${found.ruleId}+tax_mismatch` };
  }
  return found;
}
