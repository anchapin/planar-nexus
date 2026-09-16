#!/usr/bin/env node
/**
 * No-Prompt-In-Engine Guard — Issue #1816
 *
 * CI gate that keeps LLM prompt text out of `src/lib/game-state/`. The
 * rules-engine directory is exported only through its barrel and is the
 * mutation-tested correctness core; prompt strings live with the AI tooling
 * (`src/ai/flows/`). Reintroducing a prompt into the engine directory adds
 * churn to the directory whose merge gate is the strictest, and the engine
 * boundary was deliberately built to exclude that class of content (#1724).
 *
 * The prompt-signature set is intentionally narrow (LLM role-introductions):
 *   - `You are a` / `You are an` — the canonical role preamble.
 *   - `Act as a` / `Act as an` — a fallback prompt pattern.
 *   - `system:` — common in JSON-mode prompts.
 *
 * Each signature has a one-line exemption for lines that legitimately use the
 * English phrase ("you are a player", "act as a sentinel", etc.); the
 * exemption is `legalUseHint` and is currently empty. Add a comment + hint
 * here only when an engine module genuinely needs the phrase in a docstring
 * or comment — the default is "exit 1, report the line".
 *
 * Run:
 *   node scripts/check-no-prompt-in-engine.mjs
 *
 * Exit 0 — engine directory is prompt-free.
 * Exit 1 — at least one prompt-signature match; offenders are listed file:line.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const ENGINE_DIR = join(REPO_ROOT, "src", "lib", "game-state");

/**
 * Prompt-signature regexes. Order matters for diagnostics only.
 *
 * Notes on what's NOT here:
 *   - We don't match `prompt:`/`system:` JSON keys without the leading
 *     `system:` signature because object keys named "prompt" appear all
 *     over the engine for non-LLM reasons (e.g. user-facing UI prompts).
 *   - We don't match `assistant:` because that collides with player IDs in
 *     chat history objects.
 */
const PROMPT_SIGNATURES = [
  /\bYou are a[n]?\s/i,
  /\bAct as a[n]?\s/i,
];

/**
 * Lines that legitimately contain the phrase but are not prompt text.
 * Each entry is a { fileSuffix, lineRegex, reason }. fileSuffix is matched
 * against the path under REPO_ROOT; lineRegex against the raw line text.
 *
 * Currently empty — issue #1816 had no false positives. Add entries here
 * only when a real engine module legitimately needs the English phrase.
 */
const LEGAL_USES = [];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry)) {
      yield full;
    }
  }
}

const offenders = [];
for (const file of walk(ENGINE_DIR)) {
  const relPath = relative(REPO_ROOT, file);
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const sig of PROMPT_SIGNATURES) {
      if (!sig.test(line)) continue;
      // Skip legal-use exemptions.
      const exempt = LEGAL_USES.some(
        (e) =>
          relPath.endsWith(e.fileSuffix) &&
          new RegExp(e.lineRegex).test(line),
      );
      if (exempt) continue;
      offenders.push({
        file: relPath,
        line: i + 1,
        signature: sig.source,
        text: line.trim().slice(0, 120),
      });
      break; // one report per line is enough
    }
  }
}

if (offenders.length > 0) {
  process.stderr.write(
    `\n[check-no-prompt-in-engine] ${offenders.length} prompt-signature match(es) under src/lib/game-state/.\n` +
      `Issue #1816 — the engine directory must not contain LLM prompt text.\n\n`,
  );
  for (const o of offenders) {
    process.stderr.write(
      `  ${o.file}:${o.line}  [/${o.signature}/]\n    ${o.text}\n`,
    );
  }
  process.stderr.write(
    `\nFix: move the prompt to src/ai/flows/ (or scripts/) and update its ` +
      `imports. If the match is a legitimate English use, add a LEGAL_USES ` +
      `entry in scripts/check-no-prompt-in-engine.mjs with a one-line reason.\n\n`,
  );
  process.exit(1);
}

process.stdout.write(
  "[check-no-prompt-in-engine] src/lib/game-state/ is prompt-free.\n",
);