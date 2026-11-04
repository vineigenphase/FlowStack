/**
 * Builds fixtures/labelled/*.json from the synthetic Copperpot set (SAMPLE data) plus variants.
 *
 * The labels are a person's judgement of whether each line is a real problem for this business — NOT
 * the engine's output. These first labels were drafted by Claude from the business story below and must
 * be reviewed by Vinu/Luke before the gate is trusted.
 *
 * Copperpot story: a UK restaurant group. Pays for Lightspeed (EPOS), Deputy (rota), Dext (bill capture),
 * Pleo (cards). No payroll app, no inventory/purchasing app, nothing chasing debtors.
 *
 *   pnpm tsx scripts/make-labelled.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const SRC = path.resolve("fixtures/xero/demo-uk-synthetic");
const OUT = path.resolve("fixtures/labelled");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));
const base = () =>
  Object.fromEntries(
    ["organisation", "accounts", "pl", "bs-close", "bs-open", "tb", "invoices", "banktransactions"].map((k) => [k, read(`${k}.json`)]),
  ) as Record<string, { [k: string]: unknown[] }>;

const uuid = (seed: string) => {
  const h = createHash("md5").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const LABELLER = "draft: Claude, from the business story in scripts/make-labelled.ts — needs review by a person";

type L = Record<string, string>;
const label = (entries: [string, string, string][]) => ({
  expected: Object.fromEntries(entries.map(([k, s]) => [k, s])) as L,
  why: Object.fromEntries(entries.map(([k, , w]) => [k, w])) as L,
});

// ---------- A: Copperpot as is ----------
const A = label([
  ["pl:200", "covered", "Sales come through Lightspeed"],
  ["pl:310", "flagged", "£812k of food and drink purchases with no inventory or purchasing app"],
  ["pl:477", "flagged", "£690k wages and no payroll app; Deputy only does rotas"],
  ["pl:478", "flagged", "Employer NI comes from the same missing payroll run"],
  ["pl:479", "flagged", "Pensions come from the same missing payroll run"],
  ["pl:400", "covered", "Ad spend is on Pleo cards"],
  ["pl:429", "covered", "General spend is on Pleo cards"],
  ["pl:485", "covered", "Software subscriptions are on Pleo cards"],
  ["pl:493", "covered", "Travel is on Pleo cards"],
  ["pl:408", "covered", "Cleaning bills are captured by Dext"],
  ["pl:445", "covered", "Utility bills are captured by Dext"],
  ["pl:473", "covered", "Repair bills are captured by Dext"],
  ["pl:999", "queued", "Nobody can tell what 'Sundry adjustments' is without asking"],
  ["bs:610", "flagged", "£121k owed by customers and nothing chasing it"],
  ["bs:630", "flagged", "Stock with no inventory app"],
  ["bs:800", "covered", "Supplier bills are captured by Dext"],
  ["bs:825", "flagged", "PAYE/NI balance with no payroll app"],
  ["cf:610", "flagged", "Debtors grew £33.5k with nothing chasing them"],
  ["cf:630", "flagged", "Stock grew with no inventory app"],
  ["cf:800", "covered", "Supplier bills are captured by Dext"],
  ["cf:825", "flagged", "PAYE/NI movement with no payroll app"],
]);

// ---------- B: Copperpot with the gaps filled (Staffology, MarketMan, Chaser) ----------
const B = label([
  ...Object.entries(A.expected).map(([k, s]): [string, string, string] => [k, s === "flagged" ? "covered" : s, A.why[k]!]),
]);
for (const k of ["pl:477", "pl:478", "pl:479", "bs:825", "cf:825"]) B.why[k] = "Staffology runs payroll and posts to Xero";
for (const k of ["pl:310", "bs:630", "cf:630"]) B.why[k] = "MarketMan handles stock and purchasing";
for (const k of ["bs:610", "cf:610"]) B.why[k] = "Chaser chases debtors";

function withBills(x: Record<string, { [k: string]: unknown[] }>, add: { name: string; amount: number }[]) {
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 10 + i, 15)));
  for (const b of add)
    months.forEach((m, i) =>
      x.invoices!.Invoices!.push({
        InvoiceID: uuid(`bill:${b.name}:${i}`),
        Type: "ACCPAY",
        Contact: { ContactID: uuid(`contact:${b.name}`), Name: b.name },
        Date: `/Date(${m.getTime()}+0000)/`,
        Status: "PAID",
        Total: b.amount,
        CurrencyCode: "GBP",
        CurrencyRate: 1,
      }),
    );
  return x;
}

// ---------- C: Copperpot where Xero returns Accounts Receivable without a type ----------
function dropType(x: Record<string, { [k: string]: unknown[] }>, code: string) {
  for (const a of x.accounts!.Accounts as { Code?: string; Type?: string }[]) if (a.Code === code) a.Type = "";
  return x;
}
const C = label(
  Object.entries(A.expected)
    .filter(([k]) => !k.startsWith("cf:"))
    .map(([k, s]): [string, string, string] => [k, s, A.why[k]!]),
);
C.expected["bs:610"] = "queued";
C.why["bs:610"] = "Account has no type, so we can't say what it is";

const files = [
  { file: "copperpot.json", name: "Copperpot Kitchens (sample)", xero: base(), labels: A, defaults: { pl: "fine", bs: "fine", cf: "fine" } },
  {
    file: "copperpot-full-stack.json",
    name: "Copperpot Kitchens, gaps filled (sample)",
    xero: withBills(base(), [
      { name: "Staffology Ltd", amount: 180 },
      { name: "MarketMan", amount: 220 },
      { name: "Chaser Technologies Ltd", amount: 95 },
    ]),
    labels: B,
    defaults: { pl: "fine", bs: "fine", cf: "fine" },
  },
  // Unreconciled cash flow: every cash flow line should show "Checking".
  { file: "copperpot-missing-type.json", name: "Copperpot Kitchens, AR missing type (sample)", xero: dropType(base(), "610"), labels: C, defaults: { pl: "fine", bs: "fine", cf: "queued" } },
];

fs.mkdirSync(OUT, { recursive: true });
for (const f of files) {
  fs.writeFileSync(
    path.join(OUT, f.file),
    JSON.stringify({ name: f.name, sample: true, labelled_by: LABELLER, now: "2026-11-04T12:00:00Z", markets: ["UK"], defaults: f.defaults, expected: f.labels.expected, why: f.labels.why, xero: f.xero }) + "\n",
  );
  console.log(`wrote ${f.file}: ${Object.keys(f.labels.expected).length} labelled lines`);
}
