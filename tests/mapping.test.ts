/** v1.1 M: mapping led by Xero's reporting code (tagging) and tax rate, with name synonyms, across 3 charts. */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { accountCategories, mappingCatalog, validateCatalog } from "@/lib/catalog/load";
import { mapAccounts } from "@/lib/mapping";
import { matchAccount, taxClass } from "@/lib/mapping/rules";
import { AccountsResponse } from "@/lib/xero/schemas";

const DIR = "fixtures/xero/charts";
const cats = accountCategories();
const catalog = mappingCatalog();

describe("catalogue files", () => {
  it("reporting codes and synonyms point at real categories", () => {
    expect(validateCatalog()).toEqual([]);
  });
});

describe.each(fs.readdirSync(DIR).filter((f) => f.endsWith(".json")))("chart %s", (file) => {
  const raw = JSON.parse(fs.readFileSync(`${DIR}/${file}`, "utf8")) as { expected: Record<string, string> };
  const accounts = AccountsResponse.parse(raw).Accounts;
  it("maps every account to the expected category (unmapped = goes to a person)", async () => {
    const { maps } = await mapAccounts({
      accounts: accounts.map((a) => ({ xeroAccountId: a.AccountID, code: a.Code, name: a.Name, type: a.Type, reportingCode: a.ReportingCode, taxType: a.TaxType })),
      categories: cats,
      confirmed: new Map(),
      minConfidence: 0.75,
      catalog,
    });
    const got = Object.fromEntries(accounts.map((a) => [a.Name, maps.find((m) => m.xeroAccountId === a.AccountID)!.category]));
    expect(got).toEqual(raw.expected);
  });
});

describe("rules", () => {
  const a = (name: string, type: string, extra: { reportingCode?: string; taxType?: string } = {}) => ({ xeroAccountId: name, name, type, ...extra });
  it("the tagging beats the name", () => {
    // Named like rent, tagged as wages: the tag wins.
    expect(matchAccount(a("Rent-a-crew", "OVERHEADS", { reportingCode: "EXP.STF.WAG" }), cats, catalog)).toMatchObject({ category: "wages", confidence: 0.9 });
    // Longest prefix: EXP.ADM.FOR.RGL → EXP.ADM.FOR.
    expect(matchAccount(a("Realised gains", "EXPENSE", { reportingCode: "EXP.ADM.FOR.RGL" }), cats, catalog)?.category).toBe("fx_gains_losses");
    // A broad tag says nothing: falls through to names.
    expect(matchAccount(a("Labour", "OVERHEADS", { reportingCode: "EXP" }), cats, catalog)).toMatchObject({ category: "wages", confidence: 0.8 });
  });
  it("tax rate: VAT on a wages account means agency labour, sent to a person", () => {
    expect(matchAccount(a("Labour", "OVERHEADS", { taxType: "INPUT2" }), cats, catalog)).toMatchObject({ category: "contractors", confidence: 0.7 });
    expect(matchAccount(a("Pensions", "OVERHEADS", { taxType: "INPUT2" }), cats, catalog)).toMatchObject({ category: "pensions", confidence: 0.65 });
    expect(matchAccount(a("Pensions", "OVERHEADS", { taxType: "NONE" }), cats, catalog)).toMatchObject({ category: "pensions", confidence: 0.8 });
  });
  it("names win on generic types where the decisive type is missing (first live chart, 13 Nov 2026)", () => {
    const cat = (name: string, type: string, rc?: string) => matchAccount(a(name, type, rc ? { reportingCode: rc } : {}), cats, catalog);
    expect(cat("Stock - Green Tea", "CURRENT", "ASS")).toMatchObject({ category: "inventory", confidence: 0.8 });
    expect(cat("Prepayments", "CURRENT", "ASS")).toMatchObject({ category: "prepayments", confidence: 0.8 });
    expect(cat("Deposits - Rent", "CURRENT", "ASS")?.category).toBe("other_debtors");
    expect(cat("Depreciation", "OVERHEADS")?.category).toBe("depreciation");
    expect(cat("Share premium", "EQUITY")?.category).toBe("share_capital");
    expect(cat("Shareholder Funds", "EQUITY", "EQU")?.category).toBe("other_equity");
    expect(cat("Shareholder Loan", "CURRLIAB", "LIA")?.category).toBe("directors_loan");
    expect(cat("Discounts", "REVENUE", "REV")?.category).toBe("sales");
    expect(cat("Concession Commission Charge", "OVERHEADS", "EXP")?.category).toBe("card_fees");
    expect(cat("Cleaning", "DIRECTCOSTS", "EXP")?.category).toBe("cleaning");
    // Any equity account is at least "other equity", never left for a person.
    expect(cat("Reserve XYZ", "EQUITY")).toMatchObject({ category: "other_equity", confidence: 0.76 });
    // The decisive type alone still maps; a generic type alone does not.
    expect(cat("Matcha", "INVENTORY")).toMatchObject({ category: "inventory", confidence: 0.9 });
    expect(cat("Matcha", "CURRENT")).toBeNull();
  });
  it("tax classes", () => {
    expect([taxClass("INPUT2"), taxClass("NONE"), taxClass("EXEMPTINPUT"), taxClass("ZERORATEDINPUT"), taxClass("REVERSECHARGES"), taxClass(null)]).toEqual([
      "vat", "no_vat", "no_vat", "no_vat", null, null,
    ]);
  });
});
