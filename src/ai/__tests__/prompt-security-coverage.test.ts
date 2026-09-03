/**
 * Regression-prevention audit: every flow file under `src/ai/flows/` that
 * builds a prompt string from a function parameter must import at least
 * one of the prompt-injection guardrails exported from
 * `@/ai/prompt-security` (issue #1586).
 *
 * The detection is intentionally conservative so it stays actionable:
 *
 *   A file is "flagged" if its source (after comments are stripped) matches
 *   any of:
 *
 *     - `SECURITY_PREAMBLE` is referenced (a tell of inline prompt assembly)
 *     - `wrapUntrusted` or `sanitizeUserInput` is referenced (already uses
 *       the guardrail helper — passes by definition)
 *     - An exported function whose name ends in `Prompt`
 *     - An inline template literal whose body contains prompt keywords
 *       (`system`, `instructions`, `you are`, `respond as`, …)
 *     - The Vercel AI SDK direct-call pattern with a `system:` argument
 *       inside the call's body (i.e. inline prompt assembly, not just a
 *       downstream wrapper like `coach-stream.ts`).
 *
 *   For each flagged file, the test asserts the file imports at least one
 *   of { `sanitizeUserInput`, `wrapUntrusted`, `SECURITY_PREAMBLE` } from
 *   `@/ai/prompt-security`. A failure surfaces as a list of offending
 *   files in the assertion message so the maintainer can pinpoint the
 *   regression without re-running the audit by hand.
 *
 * Heuristic-only flows (no prompt assembly) do NOT match the patterns and
 * therefore do NOT need the import — they are intentionally excluded so
 * this PR does not have to touch unrelated files.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const FLOWS_DIR = path.resolve(__dirname, "..", "..", "ai", "flows");

// Match the three guardrail symbols from `@/ai/prompt-security`. Either a
// bare `from "@/ai/prompt-security"` import with one of these identifiers,
// or a `SECURITY_PREAMBLE` constant reference inside `import { ... }`.
const GUARDRAIL_IMPORTS = [
  /\bimport\b[^;]*?from\s+["']@\/ai\/prompt-security["']/,
];

const GUARDRAIL_NAMES = [
  "sanitizeUserInput",
  "wrapUntrusted",
  "SECURITY_PREAMBLE",
] as const;

// Patterns that, when matched in a file's source code (without comments),
// indicate that the file builds a prompt string from a function parameter.
// Each pattern is anchored where possible so legitimate uses of e.g.
// `generateText` in a generic wrapper are still excluded when no system
// argument is present.
const PROMPT_BUILDING_PATTERNS: ReadonlyArray<RegExp> = [
  // Uses the SECURITY_PREAMBLE constant directly. Strong signal of an
  // inline prompt-assembly site.
  /\bSECURITY_PREAMBLE\b/,

  // Already references the sanitizer / wrapper (so the import is required
  // for the file to type-check at all — this is a free pass).
  /\b(?:sanitizeUserInput|wrapUntrusted)\b/,

  // Exported function ending in "Prompt" — naming convention only used by
  // the guardrailed assembly helpers.
  /^export\s+(?:async\s+)?function\s+\w+Prompt\s*\(/m,

  // Exported arrow / const whose name ends in "Prompt".
  /^export\s+const\s+\w+Prompt\s*[:=]/m,

  // Inline template literal whose body contains prompt keywords.
  /`[^`]*\$\{[^}]+\}[^`]*(?:system\s+prompt|instructions?|you\s+are|respond\s+as)/i,

  // Vercel AI SDK call with a `system:` argument inside the same literal
  // (i.e. inline prompt assembly). Wrapper modules that delegate via
  // structured objects without a literal `system:` string are NOT flagged
  // — they inherit the upstream guardrails.
  /\b(?:generateText|streamText|streamObject|generateObject)\s*\(\s*\{[\s\S]{0,400}?\bsystem\s*:/,
];

function stripCommentsAndStrings(source: string): string {
  // Strip block comments, then single-line comments. Strings are preserved
  // because they may legitimately contain keywords we want to detect
  // (e.g. a system prompt literally text).
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/^\s*\/\/.*$/gm, "");
  return out;
}

function hasGuardrailImport(file: string): boolean {
  if (!GUARDRAIL_IMPORTS.some((re) => re.test(file))) return false;
  // Confirm the import pulls in at least one of the three guardrail names
  // (a defensive check so an `import { clampString } from "..."` does NOT
  // count as a guardrail import).
  const importBlockMatch = file.match(
    /\bimport\s*\{([^}]+)\}\s*from\s*["']@\/ai\/prompt-security["']/,
  );
  if (!importBlockMatch) return false;
  const names = importBlockMatch[1];
  return GUARDRAIL_NAMES.some((n) => new RegExp(`\\b${n}\\b`).test(names));
}

function buildsPrompts(strippedSource: string): boolean {
  return PROMPT_BUILDING_PATTERNS.some((re) => re.test(strippedSource));
}

function collectFlowFiles(): string[] {
  return fs
    .readdirSync(FLOWS_DIR)
    .filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.startsWith("__"),
    )
    .map((f) => path.join(FLOWS_DIR, f));
}

/**
 * Files explicitly out of scope of issue #1586. Each entry has a
 * one-line rationale documenting why the guardrail exemption is safe. New
 * additions here are a smell — they should be reviewed against the
 * prompt-injection scope before being exempted.
 */
const EXCLUDED_FILES: ReadonlyMap<string, string> = new Map([
  [
    "coach-evidence-ledger.ts",
    // COACH-family downstream helper. `renderLedgerForPrompt` consumes an
    // EvidenceLedger constructed server-side from already-sanitised
    // analysis; no raw user input reaches the helper. Guardrails live at
    // the upstream caller in context-builder.ts.
    "coach downstream helper; guardrails at upstream caller",
  ],
  [
    "ai-meta-analysis.ts",
    // LLM-routed with local-first fallback (#1073 family). NOT one of the
    // 4 sibling flows named in issue #1586; PR scope forbids drive-by
    // refactor. Tracked separately for a follow-up.
    "out-of-scope LLM-routed sibling flow (not in issue #1586)",
  ],
  [
    "coach-stream.ts",
    // Streaming wrapper for the COACH family. Consumes already-sanitised
    // system + messages from context-builder.ts / genkit-coach-flow.ts /
    // api/chat routes. Guardrails at upstream callers.
    "downstream streamer; guardrails at upstream callers",
  ],
]);

describe("prompt-security coverage (issue #1586)", () => {
  // Allow this audit to be overridden only by an explicit env flag so a
  // maintainer can temporarily disable the regression guard if a flow is
  // intentionally heuristic-only. Default = enforced.
  const auditEnabled = process.env.DISABLE_PROMPT_SECURITY_AUDIT !== "1";

  it.each(collectFlowFiles().map((f) => [path.basename(f), f] as const))(
    "%s imports a prompt-injection guardrail if it builds prompts",
    (label, filePath) => {
      if (!auditEnabled) return;
      if (EXCLUDED_FILES.has(label)) return;
      const source = fs.readFileSync(filePath, "utf8");
      const stripped = stripCommentsAndStrings(source);

      // 1. Heuristic detection: is the file a prompt-building site?
      if (!buildsPrompts(stripped)) {
        // Pure heuristic flow. No requirement.
        return;
      }

      // 2. Requirement: a guardrail import is present.
      expect(hasGuardrailImport(source)).toBe(true);
    },
    60_000,
  );

  it("surfaces a list of failing files for maintainer ergonomics", () => {
    if (!auditEnabled) return;
    const offenders: Array<{ file: string; reason: string }> = [];
    for (const filePath of collectFlowFiles()) {
      const name = path.basename(filePath);
      if (EXCLUDED_FILES.has(name)) continue;
      const source = fs.readFileSync(filePath, "utf8");
      const stripped = stripCommentsAndStrings(source);
      if (buildsPrompts(stripped) && !hasGuardrailImport(source)) {
        offenders.push({ file: name, reason: "builds prompts, no guardrail import" });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("excludes only files with a documented rationale", () => {
    // Defensive check: every entry in EXCLUDED_FILES must have a non-empty
    // rationale. This stops the list from silently growing into a
    // "blanket exception" pile.
    for (const [, reason] of EXCLUDED_FILES) {
      expect(reason).toMatch(/\S+/);
    }
  });

  it("does not flag heuristic-only flows (sanity test for the detection regex)", () => {
    if (!auditEnabled) return;
    // Spot-check: sideboard-plan.ts and compare-decks.ts are explicitly
    // heuristic-only per CLAUDE.md and never construct prompts. They
    // should not be flagged. If this assertion ever fails the detection
    // regex has grown too aggressive and needs tightening.
    const excluded = ["sideboard-plan.ts", "compare-decks.ts"];
    const stripped: Record<string, boolean> = {};
    for (const name of excluded) {
      const filePath = path.join(FLOWS_DIR, name);
      if (!fs.existsSync(filePath)) continue;
      stripped[name] = buildsPrompts(
        stripCommentsAndStrings(fs.readFileSync(filePath, "utf8")),
      );
    }
    for (const [name, flagged] of Object.entries(stripped)) {
      expect({ [name]: flagged }).toEqual({ [name]: false });
    }
  });
});
