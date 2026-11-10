"""
SAMPLE fixtures for the monthly reports (v1.1 B), derived from the synthetic year-to-date fixtures:

  bs-monthly.json  BalanceSheet, date=31 Oct 2026, periods=11, timeframe=MONTH → 12 month-end columns, newest first
  pl-monthly.json  ProfitAndLoss, Oct 2026, periods=11, timeframe=MONTH       → 12 monthly columns, newest first

How the numbers are made (synthetic, not real data):
  - Column 0 equals bs-close and column 7 (31 Mar 2026, the prior year end) equals bs-open exactly, so the
    year-to-date statements are unchanged.
  - Months in between move in a straight line from open to close. Current Year Earnings builds up evenly
    (close × (7 − i) / 7) and Retained Earnings stays at its closing value until the year end, as in a real ledger.
  - Months 8–11 (before the year end) repeat the opening balance sheet.
  - Each monthly P&L column is the year-to-date P&L ÷ 7, so the months reconcile to the cash flow.
Run: python scripts/make-monthly-fixtures.py [set ...]   (default: demo-uk-synthetic)
"""
import io
import json
from datetime import date, timedelta

import sys

SETS = sys.argv[1:] or ["demo-uk-synthetic"]
MONTHS = 12
FY_INDEX = 7  # 31 Mar 2026 is 7 month ends before 31 Oct 2026


def load(name):
    return json.load(io.open(f"{DIR}/{name}.json", encoding="utf-8"))


DIR = ""


def month_end(y, m):
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return nxt - timedelta(days=1)


ends = []
y, m = 2026, 10
for _ in range(MONTHS):
    ends.append(month_end(y, m))
    m -= 1
    if m == 0:
        y, m = y - 1, 12


def num(v):
    s = (v or "").replace(",", "").strip()
    return float(s) if s else 0.0


def fmt(x):
    return f"{x:.2f}"


def key_of(row):
    cells = row.get("Cells") or []
    attrs = (cells[0].get("Attributes") if cells else None) or []
    acc = next((a["Value"] for a in attrs if a["Id"].lower() == "account"), None)
    return acc or f"label:{cells[0]['Value'] if cells else ''}"


def flat(report):
    out = {}

    def walk(rows, section):
        for r in rows:
            if r["RowType"] == "Section":
                walk(r.get("Rows", []), r.get("Title", ""))
            elif r["RowType"] != "Header":
                out[(section, key_of(r))] = num(r["Cells"][1]["Value"]) if len(r["Cells"]) > 1 else 0.0

    walk(report["Reports"][0]["Rows"], "")
    return out


def with_columns(template, values_for, header):
    rep = json.loads(json.dumps(template))
    r0 = rep["Reports"][0]

    def walk(rows, section):
        for r in rows:
            if r["RowType"] == "Header":
                r["Cells"] = [{"Value": ""}] + [{"Value": h} for h in header]
            elif r["RowType"] == "Section":
                walk(r.get("Rows", []), r.get("Title", ""))
            else:
                first = r["Cells"][0]
                attrs = first.get("Attributes")
                vals = values_for(section, key_of(r))
                r["Cells"] = [first] + [dict({"Value": fmt(v)}, **({"Attributes": attrs} if attrs else {})) for v in vals]

    walk(r0["Rows"], "")
    return rep


def run():
    global c, o, p, retained
    ORG = json.load(io.open(f"{DIR}/organisation.json", encoding="utf-8"))["Organisations"][0]["Name"]
    close, opening = load("bs-close"), load("bs-open")
    c, o = flat(close), flat(opening)


    def bs_values(section, key, label=None):
        cv, ov = c.get((section, key), 0.0), o.get((section, key), 0.0)
        label = (label or key).lower()
        out = []
        for i in range(MONTHS):
            if i >= FY_INDEX:
                out.append(ov)
            elif "current year earnings" in label:
                out.append(cv * (FY_INDEX - i) / FY_INDEX)
            elif "retained earnings" in label:
                out.append(cv)
            else:
                out.append(cv + (ov - cv) * i / FY_INDEX)
        return out


    # Retained earnings is an account row; find its id by name in the close report to treat it as "retained earnings".
    def tag_retained(report):
        ids = set()

        def walk(rows):
            for r in rows:
                if r["RowType"] == "Section":
                    walk(r.get("Rows", []))
                elif r["RowType"] == "Row" and "retained earnings" in r["Cells"][0]["Value"].lower():
                    ids.add(key_of(r))

        walk(report["Reports"][0]["Rows"])
        return ids


    retained = tag_retained(close)


    def bs_values_tagged(section, key):
        return bs_values(section, key, "retained earnings" if key in retained else None)


    bs = with_columns(close, bs_values_tagged, [d.strftime("%-d %b %Y") if False else f"{d.day} {d.strftime('%b %Y')}" for d in ends])
    bs["Reports"][0]["ReportTitles"] = ["Balance Sheet", ORG, "As at 31 Oct 2026"]

    pl_t = load("pl")
    p = flat(pl_t)
    pl = with_columns(pl_t, lambda s, k: [p.get((s, k), 0.0) / FY_INDEX] * MONTHS, [d.strftime("%b %y") for d in ends])
    pl["Reports"][0]["ReportTitles"] = ["Profit & Loss", ORG, "1 October 2026 to 31 October 2026"]

    for name, rep in (("bs-monthly", bs), ("pl-monthly", pl)):
        io.open(f"{DIR}/{name}.json", "w", encoding="utf-8", newline="\n").write(json.dumps(rep, indent=1) + "\n")
    print("wrote bs-monthly.json, pl-monthly.json")


for DIR in [f"fixtures/xero/{x}" for x in SETS]:
    run()
