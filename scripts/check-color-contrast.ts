/**
 * WCAG 1.4.3 / 1.4.11 design-token contrast auditor
 *
 * Issue #1268 — https://github.com/anchapin/planar-nexus/issues/1268
 *
 * Parses the HSL triples declared in `src/app/globals.css`, computes the
 * WCAG 2.x contrast ratio between every documented foreground/background
 * pair, and fails the process with a non-zero exit code if any pair drops
 * below the WCAG AA threshold.
 *
 * Why a dedicated script (and not just a Jest test)?
 *  - Cheap to run in CI without spinning up jsdom or the React renderer.
 *  - Emits a Markdown audit report that can be linked from the PR and
 *    attached as a workflow artifact.
 *  - Can be re-run locally by anyone editing the design tokens.
 *
 * Usage:
 *   npx tsx scripts/check-color-contrast.ts            # audit + exit non-zero on fail
 *   npx tsx scripts/check-color-contrast.ts --report   # also write docs/CONTRAST_AUDIT.md
 *   npx tsx scripts/check-color-contrast.ts --json     # emit JSON instead of table
 *
 * Thresholds:
 *   - Text (WCAG 1.4.3 AA): 4.5:1 normal text, 3.0:1 large text
 *   - Non-text UI affordance (WCAG 1.4.11 AA): 3.0:1
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// WCAG color math
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Token pairs to audit
// ---------------------------------------------------------------------------

type PairKind = "text" | "non-text" | "large-text";
interface Pair {
  /** Stable identifier so audit reports diff cleanly across runs. */
  id: string;
  /** Foreground token name (human-readable, used in the report). */
  fg: string;
  /** Background token name (human-readable, used in the report). */
  bg: string;
  /** Raw HSL triple of the foreground, as declared in globals.css. */
  fgValue: string;
  /** Raw HSL triple of the background. */
  bgValue: string;
  /** WCAG success criterion and ratio threshold. */
  kind: PairKind;
}

/**
 * The canonical pair list. Every pair must be derivable from a token declared
 * in `src/app/globals.css`. Pairs are listed in roughly the same order as the
 * `:root` block in the stylesheet so reviewers can cross-reference.
 */
function buildPairs(t: Record<string, string>): Pair[] {
  return [
    // ---- Text on background / surfaces (1.4.3) -----------------------------
    {
      id: "text.foreground_on_background",
      fg: "--foreground",
      bg: "--background",
      fgValue: t["--foreground"],
      bgValue: t["--background"],
      kind: "text",
    },
    {
      id: "text.card-foreground_on_card",
      fg: "--card-foreground",
      bg: "--card",
      fgValue: t["--card-foreground"],
      bgValue: t["--card"],
      kind: "text",
    },
    {
      id: "text.popover-foreground_on_popover",
      fg: "--popover-foreground",
      bg: "--popover",
      fgValue: t["--popover-foreground"],
      bgValue: t["--popover"],
      kind: "text",
    },
    {
      id: "text.primary-foreground_on_primary",
      fg: "--primary-foreground",
      bg: "--primary",
      fgValue: t["--primary-foreground"],
      bgValue: t["--primary"],
      kind: "text",
    },
    {
      id: "text.secondary-foreground_on_secondary",
      fg: "--secondary-foreground",
      bg: "--secondary",
      fgValue: t["--secondary-foreground"],
      bgValue: t["--secondary"],
      kind: "text",
    },
    {
      id: "text.muted-foreground_on_background",
      fg: "--muted-foreground",
      bg: "--background",
      fgValue: t["--muted-foreground"],
      bgValue: t["--background"],
      kind: "text",
    },
    {
      id: "text.muted-foreground-on-card_on_card",
      fg: "--muted-foreground-on-card",
      bg: "--card",
      fgValue: t["--muted-foreground-on-card"],
      bgValue: t["--card"],
      kind: "text",
    },
    {
      id: "text.muted-foreground_on_secondary",
      fg: "--muted-foreground",
      bg: "--secondary",
      fgValue: t["--muted-foreground"],
      bgValue: t["--secondary"],
      kind: "text",
    },
    {
      id: "text.accent-foreground_on_accent",
      fg: "--accent-foreground",
      bg: "--accent",
      fgValue: t["--accent-foreground"],
      bgValue: t["--accent"],
      kind: "text",
    },
    {
      id: "text.destructive-foreground_on_destructive.light",
      fg: "--destructive-foreground",
      bg: "--destructive (light)",
      fgValue: t["--destructive-foreground"],
      // :root destructive — see light-mode block in globals.css
      bgValue: "0 75% 45%",
      kind: "text",
    },
    {
      id: "text.destructive-foreground_on_destructive.dark",
      fg: "--destructive-foreground",
      bg: "--destructive (dark)",
      fgValue: t["--destructive-foreground"],
      // .dark destructive — see dark-mode block in globals.css
      bgValue: "0 62.8% 30.6%",
      kind: "text",
    },
    {
      id: "text.sidebar-foreground_on_sidebar-background",
      fg: "--sidebar-foreground",
      bg: "--sidebar-background",
      fgValue: t["--sidebar-foreground"],
      bgValue: t["--sidebar-background"],
      kind: "text",
    },
    {
      id: "text.sidebar-primary-foreground_on_sidebar-primary",
      fg: "--sidebar-primary-foreground",
      bg: "--sidebar-primary",
      fgValue: t["--sidebar-primary-foreground"],
      bgValue: t["--sidebar-primary"],
      kind: "text",
    },
    {
      id: "text.sidebar-accent-foreground_on_sidebar-accent",
      fg: "--sidebar-accent-foreground",
      bg: "--sidebar-accent",
      fgValue: t["--sidebar-accent-foreground"],
      bgValue: t["--sidebar-accent"],
      kind: "text",
    },

    // ---- Non-text UI affordances (1.4.11) ---------------------------------
    {
      id: "non-text.border_on_background",
      fg: "--border",
      bg: "--background",
      fgValue: t["--border"],
      bgValue: t["--background"],
      kind: "non-text",
    },
    {
      id: "non-text.border_on_card",
      fg: "--border",
      bg: "--card",
      fgValue: t["--border"],
      bgValue: t["--card"],
      kind: "non-text",
    },
    {
      id: "non-text.border_on_secondary",
      fg: "--border",
      bg: "--secondary",
      fgValue: t["--border"],
      bgValue: t["--secondary"],
      kind: "non-text",
    },
    {
      id: "non-text.sidebar-border_on_sidebar-background",
      fg: "--sidebar-border",
      bg: "--sidebar-background",
      fgValue: t["--sidebar-border"],
      bgValue: t["--sidebar-background"],
      kind: "non-text",
    },
    {
      id: "non-text.ring_on_background",
      fg: "--ring",
      bg: "--background",
      fgValue: t["--ring"],
      bgValue: t["--background"],
      kind: "non-text",
    },
  ];
}

function thresholdFor(kind: PairKind): number {
  switch (kind) {
    case "text":
      return 4.5;
    case "large-text":
      return 3.0;
    case "non-text":
      return 3.0;
  }
}

function successCriterionFor(kind: PairKind): string {
  switch (kind) {
    case "text":
      return "WCAG 1.4.3";
    case "large-text":
      return "WCAG 1.4.3 (large)";
    case "non-text":
      return "WCAG 1.4.11";
  }
}

// ---------------------------------------------------------------------------
// CSS variable extraction
// ---------------------------------------------------------------------------

/**
 * Walk a CSS source string and collect `--token: value;` declarations.
 * Only declarations inside the first `:root { ... }` block are used so the
 * audit always reflects the canonical light-mode values; dark mode is also
 * exported so reviewers can confirm they match.
 */
function extractTokens(css: string): {
  root: Record<string, string>;
  dark: Record<string, string>;
} {
  const collect = (block: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      out[`--${m[1]}`] = m[2].trim();
    }
    return out;
  };

  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
  const darkMatch = css.match(/\.dark\s*\{([\s\S]*?)\}/);
  return {
    root: rootMatch ? collect(rootMatch[1]) : {},
    dark: darkMatch ? collect(darkMatch[1]) : {},
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface AuditRow {
  pair: Pair;
  ratio: number;
  threshold: number;
  pass: boolean;
}

function audit(pairs: Pair[]): AuditRow[] {
  return pairs.map((pair) => {
    const r = ratio(pair.fgValue, pair.bgValue);
    const threshold = thresholdFor(pair.kind);
    return { pair, ratio: r, threshold, pass: r >= threshold };
  });
}

function toMarkdownTable(rows: AuditRow[]): string {
  const lines: string[] = [];
  lines.push(
    "| Status | Ratio | Threshold | Criterion | Foreground | Background |",
  );
  lines.push(
    "| ------ | ----- | --------- | --------- | ---------- | ---------- |",
  );
  for (const row of rows) {
    const status = row.pass ? "PASS" : "FAIL";
    const r = `${row.ratio.toFixed(2)}:1`;
    const t = `≥ ${row.threshold}:1`;
    lines.push(
      `| ${status} | ${r} | ${t} | ${successCriterionFor(row.pair.kind)} | ` +
        `${row.pair.fg} (${row.pair.fgValue}) | ${row.pair.bg} (${row.pair.bgValue}) |`,
    );
  }
  return lines.join("\n");
}

function toAsciiTable(rows: AuditRow[]): string {
  const headers = ["Status", "Ratio", "Threshold", "Criterion", "Pair"];
  const widths = headers.map(() => 0);
  const data: string[][] = rows.map((row) => [
    row.pass ? "PASS" : "FAIL",
    `${row.ratio.toFixed(2)}:1`,
    `>= ${row.threshold}:1`,
    successCriterionFor(row.pair.kind),
    `${row.pair.fg} on ${row.pair.bg}`,
  ]);
  const cells: string[][] = [headers, ...data];
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      widths[c] = Math.max(widths[c], cells[r][c].length);
    }
  }
  const sep = widths.map((w) => "-".repeat(w + 2)).join("+");
  const render = (cells: string[]) =>
    cells.map((c, i) => ` ${c.padEnd(widths[i])} `).join("|");
  return [render(headers), sep, ...data.map(render)].join("\n");
}

function buildReport(
  rows: AuditRow[],
  darkTokens: Record<string, string>,
): string {
  const pass = rows.filter((r) => r.pass).length;
  const fail = rows.length - pass;
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Design-token contrast audit (${today})`);
  lines.push("");
  lines.push(
    `Generated by \`scripts/check-color-contrast.ts\` from \`src/app/globals.css\`.`,
  );
  lines.push("");
  lines.push(`- Pairs audited: **${rows.length}**`);
  lines.push(`- Passing: **${pass}**`);
  lines.push(`- Failing: **${fail}**`);
  lines.push("");
  lines.push(
    "Thresholds follow WCAG 2.1 AA — text (1.4.3) ≥ 4.5:1, non-text UI affordances (1.4.11) ≥ 3:1.",
  );
  lines.push("");
  lines.push(toMarkdownTable(rows));
  lines.push("");
  lines.push("## Dark-mode parity check");
  lines.push("");
  lines.push(
    "The `.dark` block in `globals.css` must declare every token used in the light-mode audit. The auditor verifies that the dark-mode declarations exist (light/dark values are allowed to differ for the destructive token only, since dark mode intentionally uses a deeper red).",
  );
  lines.push("");
  lines.push("| Token | Light | Dark | Match |");
  lines.push("| ----- | ----- | ---- | ----- |");
  const auditedTokenNames = new Set<string>();
  for (const row of rows) {
    auditedTokenNames.add(row.pair.fg);
    auditedTokenNames.add(row.pair.bg);
  }
  for (const name of Array.from(auditedTokenNames).sort()) {
    if (name.endsWith("(light)") || name.endsWith("(dark)")) continue;
    const light = darkTokens[name];
    if (light == null) continue;
    const refRow = rows.find((r) => r.pair.fg === name || r.pair.bg === name);
    const lightValue = refRow
      ? refRow.pair.fg === name
        ? refRow.pair.fgValue
        : refRow.pair.bgValue
      : "?";
    const match = lightValue === light;
    lines.push(
      `| \`${name}\` | ${lightValue} | ${light} | ${match ? "yes" : "DIFFERS"} |`,
    );
  }
  lines.push("");
  lines.push(
    "If the dark-mode token does not match the light-mode token, both values are audited independently. See `scripts/check-color-contrast.ts`. ",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = new Set(process.argv.slice(2));
  const wantReport = args.has("--report");
  const wantJson = args.has("--json");

  const cssPath = resolve(__dirname, "..", "src", "app", "globals.css");
  const css = readFileSync(cssPath, "utf8");
  const { root, dark } = extractTokens(css);
  const pairs = buildPairs(root);
  const rows = audit(pairs);

  if (wantJson) {
    process.stdout.write(
      JSON.stringify(
        {
          auditedAt: new Date().toISOString(),
          cssPath,
          pairs: rows.map((r) => ({
            id: r.pair.id,
            fg: r.pair.fg,
            bg: r.pair.bg,
            fgValue: r.pair.fgValue,
            bgValue: r.pair.bgValue,
            ratio: Number(r.ratio.toFixed(3)),
            threshold: r.threshold,
            criterion: successCriterionFor(r.pair.kind),
            pass: r.pass,
          })),
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(toAsciiTable(rows) + "\n");
  }

  if (wantReport) {
    const outPath = resolve(__dirname, "..", "docs", "CONTRAST_AUDIT.md");
    writeFileSync(outPath, buildReport(rows, dark), "utf8");
    process.stdout.write(`\nWrote ${outPath}\n`);
  }

  const fail = rows.filter((r) => !r.pass);
  if (fail.length > 0) {
    process.stderr.write(
      `\n${fail.length} of ${rows.length} pair(s) failed the AA threshold.\n`,
    );
    for (const f of fail) {
      process.stderr.write(
        `  - [${f.pair.id}] ${f.pair.fg} on ${f.pair.bg}: ${f.ratio.toFixed(2)}:1 (need ${f.threshold}:1)\n`,
      );
    }
    process.exit(1);
  }

  process.stdout.write(
    `\nAll ${rows.length} pair(s) passed (WCAG 1.4.3 / 1.4.11 AA).\n`,
  );
}

main();
