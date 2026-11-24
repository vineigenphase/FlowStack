/**
 * ENGINE-V2 Phase 3: the restyle lives in tokens. No colour value outside app/tokens.css; every core token has a
 * dark value; key text/background pairs meet WCAG AA (4.5:1) in both themes, including text on the glass panel.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const walk = (dir: string, exts: string[]): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(p, exts);
    return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
  });

const tokens = fs.readFileSync("app/tokens.css", "utf8");
const block = (sel: RegExp) => {
  const m = tokens.match(sel);
  if (!m) throw new Error(`no ${sel}`);
  return Object.fromEntries([...m[1]!.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1]!, x[2]!.trim()]));
};
const light = block(/:root \{([\s\S]*?)\n\}/);
const dark = block(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/);

function rgb(v: string): [number, number, number, number] {
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [parseInt(hex[1]!.slice(0, 2), 16), parseInt(hex[1]!.slice(2, 4), 16), parseInt(hex[1]!.slice(4, 6), 16), 1];
  const m = v.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  throw new Error(`can't read colour ${v}`);
}
const over = (fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number, number] => [
  fg[0] * fg[3] + bg[0] * (1 - fg[3]),
  fg[1] * fg[3] + bg[1] * (1 - fg[3]),
  fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  1,
];
const lum = ([r, g, b]: number[]) => {
  const c = [r!, g!, b!].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe("colours live only in app/tokens.css", () => {
  it("no hex or rgb() literal in any other stylesheet, page or component", () => {
    const files = [...walk("app", [".css", ".tsx", ".ts"]), ...walk("components", [".tsx", ".ts"])].filter((f) => path.normalize(f) !== path.normalize("app/tokens.css"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b|rgba?\(\s*\d/g)) {
        const before = src.slice(Math.max(0, m.index! - 12), m.index!);
        if (/(href|id)=[{"`'][^"`'}]*$|item-\$?\{?$|`#$/.test(before)) continue; // anchors like #item-<id>, #kind
        offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every core token has a dark value; the system setting is never followed", () => {
    for (const k of ["bg", "surface", "surface-2", "border", "border-strong", "text", "text-2", "muted", "primary", "primary-soft", "success", "success-soft", "warning", "warning-soft", "danger", "danger-soft"]) {
      expect(light[k], k).toBeTruthy();
      expect(dark[k], k).toBeTruthy();
    }
    const css = [fs.readFileSync("app/globals.css", "utf8"), tokens].join("\n");
    expect(css).not.toMatch(/prefers-color-scheme/);
  });
});

describe("contrast (WCAG AA 4.5:1) in both themes", () => {
  const pairs: [string, string][] = [
    ["text", "bg"], ["text", "surface"], ["text-2", "surface"], ["text-2", "surface-2"], ["muted", "surface"], ["muted", "bg"],
    ["primary", "surface"], ["primary", "bg"], ["primary", "primary-soft"], ["on-primary", "primary"],
    ["warning", "warning-soft"], ["success", "success-soft"], ["danger", "danger-soft"], ["danger", "surface"],
  ];
  for (const [name, t] of [["light", light], ["dark", dark]] as const) {
    it(`${name}: status tags, links, buttons and body text`, () => {
      const fails = pairs.map(([fg, bg]) => [fg, bg, contrast(rgb(t[fg]!), rgb(t[bg]!))] as const).filter(([, , c]) => c < 4.5);
      expect(fails).toEqual([]);
    });
    it(`${name}: text on the glass Engine panel (over the page background)`, () => {
      const glass = over(rgb(t["glass-bg"]!), rgb(t.bg!));
      expect(contrast(rgb(t.text!), glass)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(t.muted!), glass)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
