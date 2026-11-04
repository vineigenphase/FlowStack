/**
 * Supplier spend aggregation (BACKEND.md §6.2, D3). Bills and bank spend are grouped in memory by
 * contact + month + source. Only these aggregates leave this module; the rows are discarded.
 */
import type { Bill, SpendTxn } from "@/lib/xero/endpoints";
import { normaliseName } from "./normalise";

export type SpendAgg = {
  contactId: string;
  contactName: string;
  nameNorm: string;
  month: string; // YYYY-MM-01
  amount: number; // base currency
  source: "bill" | "bank";
};

export type SupplierHints = Map<string, { accountCodes: Set<string> }>;

const monthOf = (d: Date) => `${d.toISOString().slice(0, 7)}-01`;
/** Xero's CurrencyRate is units of foreign currency per 1 unit of base currency. */
const toBase = (total: number, rate?: number) => (rate && rate > 0 ? total / rate : total);

export class SpendAggregator {
  private agg = new Map<string, SpendAgg>();
  /** Account codes seen on bank-spend lines per contact (bills come summaryOnly, without lines). */
  readonly hints: SupplierHints = new Map();

  addBills(rows: Bill[]) {
    for (const b of rows) this.add(b.Contact.ContactID, b.Contact.Name, b.Date, toBase(b.Total, b.CurrencyRate), "bill");
  }

  addSpend(rows: SpendTxn[]) {
    for (const t of rows) {
      if (!t.Contact) continue;
      this.add(t.Contact.ContactID, t.Contact.Name, t.Date, toBase(t.Total, t.CurrencyRate), "bank");
      const h = this.hints.get(t.Contact.ContactID) ?? { accountCodes: new Set<string>() };
      for (const li of t.LineItems) if (li.AccountCode) h.accountCodes.add(li.AccountCode);
      this.hints.set(t.Contact.ContactID, h);
    }
  }

  private add(contactId: string, name: string, date: Date, amount: number, source: "bill" | "bank") {
    const month = monthOf(date);
    const key = `${contactId}|${month}|${source}`;
    const cur = this.agg.get(key);
    if (cur) cur.amount += amount;
    else this.agg.set(key, { contactId, contactName: name, nameNorm: normaliseName(name), month, amount, source });
  }

  result(): SpendAgg[] {
    return [...this.agg.values()].map((a) => ({ ...a, amount: Math.round(a.amount * 100) / 100 }));
  }
}
