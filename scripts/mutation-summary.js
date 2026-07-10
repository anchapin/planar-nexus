#!/usr/bin/env node
/**
 * Per-module mutation-score breakdown.
 *
 * Reads Stryker's JSON report (`reports/mutation/mutation.json`, produced by
 * the `json` reporter in stryker.config.js) and emits a Markdown table with one
 * row per mutated module. Designed to feed the GitHub Actions job summary via
 * `$GITHUB_STEP_SUMMARY` (issue #1395) so a future regression surfaces which
 * module slipped below the gate.
 *
 *   node scripts/mutation-summary.js                 # prints Markdown to stdout
 *   GITHUB_STEP_SUMMARY=... node scripts/mutation-summary.js
 *
 * Status buckets follow Stryker's mutation-score definition: the score is the
 * share of "detected" mutants (Killed / Timeout) over the share that count
 * against the suite (Killed + Timeout + Survived + NoCoverage + RuntimeError),
 * i.e. Ignored and CompileError mutants are excluded.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPORT = path.resolve(process.cwd(), "reports/mutation/mutation.json");

function main() {
  if (!fs.existsSync(REPORT)) {
    process.stderr.write(`mutation-summary: ${REPORT} not found — skipping.\n`);
    process.exitCode = 0;
    return;
  }

  const data = JSON.parse(fs.readFileSync(REPORT, "utf8"));

  // Stryker 9.x: `files` is an object keyed by source path. Older releases use
  // an array. Normalise to [[filePath, mutants[]]] pairs.
  const entries = Array.isArray(data.files)
    ? data.files.map((f) => [f.name || f.source || "?", f.mutants || []])
    : Object.entries(data.files || {}).map(([name, f]) => [name, f.mutants || []]);

  const rows = entries
    .map(([file, mutants]) => {
      const counts = { Killed: 0, Survived: 0, NoCoverage: 0, Timeout: 0, RuntimeError: 0, Ignored: 0, CompileError: 0 };
      for (const m of mutants) {
        const s = m.status;
        if (counts[s] !== undefined) counts[s]++;
      }
      const detected = counts.Killed + counts.Timeout;
      const considered =
        counts.Killed +
        counts.Timeout +
        counts.Survived +
        counts.NoCoverage +
        counts.RuntimeError;
      const score = considered > 0 ? (detected / considered) * 100 : 0;
      return {
        file: file.replace(/^.*src\//, "src/"),
        score,
        detected,
        considered,
        survived: counts.Survived,
        noCoverage: counts.NoCoverage,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));

  const lines = [
    "### Mutation score breakdown",
    "",
    "| Module | Score | Killed/Detected | Survived | No coverage |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    const mark = r.score >= 70 ? "🟢" : r.score >= 50 ? "🟡" : "🔴";
    lines.push(
      `| ${mark} \`${r.file}\` | ${r.score.toFixed(1)}% | ${r.detected}/${r.considered} | ${r.survived} | ${r.noCoverage} |`,
    );
  }

  const markdown = lines.join("\n") + "\n";
  process.stdout.write(markdown);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(summary, markdown);
  }
}

main();
