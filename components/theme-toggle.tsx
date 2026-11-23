"use client";

/**
 * Light / dark theme for this browser (ENGINE-V2 Phase 3: light by default, dark only by choice, never from the
 * system setting). Stored in localStorage and applied by the script in app/layout.tsx before first paint.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

const KEY = "fs-theme";
const subscribe = () => () => {};
const read = (): "light" | "dark" => {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
};

export function ThemeToggle() {
  const initial = useSyncExternalStore(subscribe, read, () => "light" as const);
  const [chosen, setChosen] = useState<"light" | "dark" | null>(null);
  const theme = chosen ?? initial;
  const set = (t: "light" | "dark") => {
    setChosen(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage blocked: the change still applies until the page reloads */
    }
  };
  useEffect(() => {
    if (!chosen) return;
    const root = document.documentElement;
    if (chosen === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
  }, [chosen]);
  return (
    <fieldset className="theme-toggle">
      <legend>Appearance</legend>
      <p className="small muted">Saved in this browser.</p>
      <div className="feedback-answers" role="radiogroup" aria-label="Theme">
        {(["light", "dark"] as const).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={theme === t} className="btn ghost" onClick={() => set(t)}>
            {t === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
