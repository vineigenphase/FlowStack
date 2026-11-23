/** ENGINE-V2: one scored input, as the trace and the dev panel show it. */
export type Source = { label: string; url?: string; capturedAt?: string };

export type Input = {
  /** What the input was computed from (shown as "raw" in the trace). */
  raw: unknown;
  /** 0–1 (award_boost: 0–cap). */
  normalised: number;
  /** True when the data wasn't there; normalised is then the neutral value (never an estimate). */
  missing: boolean;
  source?: Source;
  note?: string;
};

export const missingInput = (neutral: number, note: string, raw: unknown = null): Input => ({ raw, normalised: neutral, missing: true, note });

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
