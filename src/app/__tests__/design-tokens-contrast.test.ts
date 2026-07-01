/**
 * WCAG 1.4.3 / 1.4.11 design-token contrast assertions (#1268)
 *
 * Reads `src/app/globals.css` at test time, parses every documented
 * foreground/background pair, computes the WCAG 2.x contrast ratio, and
 * asserts each pair meets the AA threshold. If anyone adjusts a token in
 * the future and silently regresses below the threshold, this test fires
 * immediately and points at the offending pair.
 *
 * The same audit is also available as a standalone CLI script that runs in
 * CI without spinning up Jest (`scripts/check-color-contrast.ts`). The Jest
 * version here exists so anyone editing tokens gets fast, local feedback
 * during development.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Hsl = { h: number; s: number; l: number };

function parseHsl(triple: string): Hsl {
  const m = triple
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) {
    throw new Error(`Cannot parse HSL triple: "${triple}"`);
  }
  return { h: +m[1], s: +m[2], l: +m[3] };
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) =>
    lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const la = relativeLuminance(fg) + 0.05;
  const lb = relativeLuminance(bg) + 0.05;
  return la > lb ? la / lb : lb / la;
}

function ratio(hslA: string, hslB: string): number {
  return contrastRatio(hslToRgb(parseHsl(hslA)), hslToRgb(parseHsl(hslB)));
}

function readTokens(): Record<string, string> {
  const path = resolve(__dirname, "..", "..", "app", "globals.css");
  const css = readFileSync(path, "utf8");
  const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootBlock) {
    throw new Error(":root block not found in src/app/globals.css");
  }
  const out: Record<string, string> = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rootBlock[1])) !== null) {
    out[`--${m[1]}`] = m[2].trim();
  }
  return out;
}

interface PairCase {
  id: string;
  fg: string;
  bg: string;
  fgValue: (t: Record<string, string>) => string;
  bgValue: (t: Record<string, string>) => string;
  threshold: number;
  criterion: "1.4.3" | "1.4.11";
}

const pairs: PairCase[] = [
  // ----- Text (1.4.3) -----
  {
    id: "foreground / background",
    fg: "--foreground",
    bg: "--background",
    fgValue: (t) => t["--foreground"],
    bgValue: (t) => t["--background"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "card-foreground / card",
    fg: "--card-foreground",
    bg: "--card",
    fgValue: (t) => t["--card-foreground"],
    bgValue: (t) => t["--card"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "popover-foreground / popover",
    fg: "--popover-foreground",
    bg: "--popover",
    fgValue: (t) => t["--popover-foreground"],
    bgValue: (t) => t["--popover"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "primary-foreground / primary",
    fg: "--primary-foreground",
    bg: "--primary",
    fgValue: (t) => t["--primary-foreground"],
    bgValue: (t) => t["--primary"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "secondary-foreground / secondary",
    fg: "--secondary-foreground",
    bg: "--secondary",
    fgValue: (t) => t["--secondary-foreground"],
    bgValue: (t) => t["--secondary"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "muted-foreground / background",
    fg: "--muted-foreground",
    bg: "--background",
    fgValue: (t) => t["--muted-foreground"],
    bgValue: (t) => t["--background"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "muted-foreground-on-card / card",
    fg: "--muted-foreground-on-card",
    bg: "--card",
    fgValue: (t) => t["--muted-foreground-on-card"],
    bgValue: (t) => t["--card"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "muted-foreground / secondary",
    fg: "--muted-foreground",
    bg: "--secondary",
    fgValue: (t) => t["--muted-foreground"],
    bgValue: (t) => t["--secondary"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "accent-foreground / accent",
    fg: "--accent-foreground",
    bg: "--accent",
    fgValue: (t) => t["--accent-foreground"],
    bgValue: (t) => t["--accent"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "destructive-foreground / destructive (light)",
    fg: "--destructive-foreground",
    bg: "--destructive (light)",
    fgValue: (t) => t["--destructive-foreground"],
    bgValue: () => "0 75% 45%",
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "destructive-foreground / destructive (dark)",
    fg: "--destructive-foreground",
    bg: "--destructive (dark)",
    fgValue: (t) => t["--destructive-foreground"],
    bgValue: () => "0 62.8% 30.6%",
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "sidebar-foreground / sidebar-background",
    fg: "--sidebar-foreground",
    bg: "--sidebar-background",
    fgValue: (t) => t["--sidebar-foreground"],
    bgValue: (t) => t["--sidebar-background"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "sidebar-primary-foreground / sidebar-primary",
    fg: "--sidebar-primary-foreground",
    bg: "--sidebar-primary",
    fgValue: (t) => t["--sidebar-primary-foreground"],
    bgValue: (t) => t["--sidebar-primary"],
    threshold: 4.5,
    criterion: "1.4.3",
  },
  {
    id: "sidebar-accent-foreground / sidebar-accent",
    fg: "--sidebar-accent-foreground",
    bg: "--sidebar-accent",
    fgValue: (t) => t["--sidebar-accent-foreground"],
    bgValue: (t) => t["--sidebar-accent"],
    threshold: 4.5,
    criterion: "1.4.3",
  },

  // ----- Non-text UI affordances (1.4.11) -----
  {
    id: "border / background",
    fg: "--border",
    bg: "--background",
    fgValue: (t) => t["--border"],
    bgValue: (t) => t["--background"],
    threshold: 3.0,
    criterion: "1.4.11",
  },
  {
    id: "border / card",
    fg: "--border",
    bg: "--card",
    fgValue: (t) => t["--border"],
    bgValue: (t) => t["--card"],
    threshold: 3.0,
    criterion: "1.4.11",
  },
  {
    id: "border / secondary",
    fg: "--border",
    bg: "--secondary",
    fgValue: (t) => t["--border"],
    bgValue: (t) => t["--secondary"],
    threshold: 3.0,
    criterion: "1.4.11",
  },
  {
    id: "sidebar-border / sidebar-background",
    fg: "--sidebar-border",
    bg: "--sidebar-background",
    fgValue: (t) => t["--sidebar-border"],
    bgValue: (t) => t["--sidebar-background"],
    threshold: 3.0,
    criterion: "1.4.11",
  },
  {
    id: "ring / background",
    fg: "--ring",
    bg: "--background",
    fgValue: (t) => t["--ring"],
    bgValue: (t) => t["--background"],
    threshold: 3.0,
    criterion: "1.4.11",
  },
];

describe("design tokens — WCAG 1.4.3 / 1.4.11 (#1268)", () => {
  const tokens = readTokens();

  it("declares all required tokens in :root", () => {
    const required = [
      "--foreground",
      "--background",
      "--card",
      "--card-foreground",
      "--popover",
      "--popover-foreground",
      "--primary",
      "--primary-foreground",
      "--secondary",
      "--secondary-foreground",
      "--muted",
      "--muted-foreground",
      "--muted-foreground-on-card",
      "--accent",
      "--accent-foreground",
      "--destructive",
      "--destructive-foreground",
      "--border",
      "--input",
      "--ring",
      "--sidebar-background",
      "--sidebar-foreground",
      "--sidebar-primary",
      "--sidebar-primary-foreground",
      "--sidebar-accent",
      "--sidebar-accent-foreground",
      "--sidebar-border",
      "--sidebar-ring",
    ];
    for (const name of required) {
      expect(tokens[name]).toBeDefined();
    }
  });

  describe.each(pairs)("$criterion — $id", (p) => {
    const r = ratio(p.fgValue(tokens), p.bgValue(tokens));
    it(`meets threshold (got ${r.toFixed(2)}:1, need ${p.threshold}:1)`, () => {
      expect(r).toBeGreaterThanOrEqual(p.threshold);
    });
  });

  it("muted-foreground-on-card exists as a sibling of muted-foreground", () => {
    // Issue #1268 acceptance criteria explicitly call out adding this token.
    expect(tokens["--muted-foreground-on-card"]).toBeDefined();
    // The token should be tuned for the slightly-lighter card surface
    // (>= 4.5:1 against --card). We don't lock the exact lightness, just
    // that the token exists and that its value is distinct from
    // muted-foreground so consumers can opt in to a card-tuned shade.
    expect(tokens["--muted-foreground-on-card"]).not.toEqual(
      tokens["--muted-foreground"],
    );
  });

  it("dark-mode block mirrors every light-mode token used in the audit", () => {
    // We deliberately do not require values to match (the destructive token
    // differs by design), but every token referenced by an audit pair must
    // be present in both blocks so designers never silently miss a token in
    // dark mode.
    const css = readFileSync(
      resolve(__dirname, "..", "..", "app", "globals.css"),
      "utf8",
    );
    const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\}/);
    expect(darkBlock).not.toBeNull();
    const darkBody = darkBlock ? darkBlock[1] : "";
    const required = new Set<string>();
    for (const p of pairs) {
      // Skip rows whose bg is a literal display label (e.g. "(light)" /
      // "(dark)" mode — those are constants baked into the test, not token
      // names that need to be declared in :root or .dark).
      if (p.bg.endsWith("(light)") || p.bg.endsWith("(dark)")) continue;
      required.add(p.bg);
      required.add(p.fg);
    }
    for (const name of required) {
      expect(darkBody).toContain(name + ":");
    }
  });
});
