/**
 * VIDEO_FIXTURE_STUB GUARD — issue #1397
 *
 * This file fails CI if:
 *   1. Any `it("validates behavior: ...")` block in `video-derived/` contains
 *      a `TODO: Implement validation` placeholder comment, OR
 *   2. Any placeholder assertion is the no-op `expect(<id>.gameState).toBeDefined()`.
 *
 * Each `*.test.ts` in this directory is auto-converted by the helper
 * `validateBehavior` (see `_helpers/validate-fixture.ts`) so every behavior
 * assertion is a real typed check against the `RecognizedBoardState`.
 *
 * If you need to revert a fixture to a placeholder (e.g. because the engine
 * doesn't yet implement the underlying rule), use `it.skip(...)` and link to
 * the tracking issue in a comment — DO NOT reintroduce a `TODO:` placeholder.
 */

import * as fs from "fs";
import * as path from "path";

const VIDEO_DIR = path.join(__dirname);

function listFixtureFiles(): string[] {
  return fs
    .readdirSync(VIDEO_DIR)
    .filter((f) => f.endsWith(".test.ts") && f !== "__guard__.test.ts")
    .map((f) => path.join(VIDEO_DIR, f));
}

describe("VIDEO_FIXTURE_STUB guard — issue #1397", () => {
  const offenders: { file: string; line: number; snippet: string }[] = [];

  afterAll(() => {
    if (offenders.length > 0) {
      const formatted = offenders
        .map(
          (o) =>
            `  ${path.relative(process.cwd(), o.file)}:${o.line}  ${o.snippet}`,
        )
        .join("\n");
      throw new Error(
        `\n[#1397] Found ${offenders.length} placeholder assertion(s) in video-derived fixtures:\n${formatted}\n\n` +
          `Each ` +
          `"validates behavior: ..."` +
          ` block must use validateBehavior() (see _helpers/validate-fixture.ts) ` +
          `or be marked it.skip(...) with a tracking issue link. See docs/TEST_VIDEO_FIXTURES.md.\n`,
      );
    }
  });

  it("every fixture must contain zero TODO: Implement validation placeholders", () => {
    for (const file of listFixtureFiles()) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (/TODO:\s*Implement validation/.test(line)) {
          offenders.push({
            file,
            line: idx + 1,
            snippet: line.trim(),
          });
        }
      });
    }
    expect(offenders.length).toBe(0);
  });

  it("no fixture may contain the no-op toBeDefined() placeholder assertion", () => {
    for (const file of listFixtureFiles()) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (/expect\([a-z_]+\.gameState\)\.toBeDefined\(\)/.test(line)) {
          offenders.push({
            file,
            line: idx + 1,
            snippet: line.trim(),
          });
        }
      });
    }
    expect(offenders.length).toBe(0);
  });
});
