"use client";

import { useState } from "react";
import { gbp } from "@/lib/ui/format";

/** Working hours in a year used for the hourly cost (UI-SPEC §5.1): salary ÷ 1,800. */
export const HOURS_PER_YEAR = 1800;

export function decisionCost(salary: number, hours: number) {
  const hourly = salary > 0 ? salary / HOURS_PER_YEAR : 0;
  return { hourly, total: hourly * Math.max(0, hours) };
}

/** "Time is salary" (UI-SPEC §5.1, NEXT-STEPS P1.11). Both inputs are examples the visitor changes. */
export function SalaryCalculator() {
  const [salary, setSalary] = useState("55000");
  const [hours, setHours] = useState("10");
  const s = Number(salary.replace(/[£,\s]/g, "")) || 0;
  const h = Number(hours) || 0;
  const { hourly, total } = decisionCost(s, h);
  return (
    <form className="stack-form" onSubmit={(e) => e.preventDefault()} aria-label="Time is salary calculator">
      <label>
        Annual salary of the person choosing (£)
        <input inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} />
      </label>
      <label>
        Hours spent on one app decision (example, change it)
        <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
      </label>
      <p aria-live="polite">
        Each app decision costs about <b className="num">{gbp(Math.round(total))}</b> of time (<span className="num">{gbp(Math.round(hourly))}</span> an hour).
      </p>
      <p className="muted small">
        Salary ÷ {HOURS_PER_YEAR.toLocaleString("en-GB")} working hours = hourly cost; × hours per decision = cost per decision.
      </p>
    </form>
  );
}
