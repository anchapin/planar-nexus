/**
 * @fileOverview Issue #1571 — build-time guard for committed TURN credentials.
 *
 * The lane brief explicitly lists "AVOID: TURN credentials leaking into
 * client bundles" as a hard constraint: every `NEXT_PUBLIC_*` variable is
 * inlined into the client bundle by Next.js, so any operator who sets
 * `NEXT_PUBLIC_TURN_PASS` to a real Coturn password ships it to every
 * browser/Tauri shell that loads the app. `PUBLIC_FALLBACK_TURN_SERVERS`
 * (src/lib/ice-config.ts:84-103) intentionally ships public OpenRelay
 * credentials with shared `openrelayproject` / `openrelayproject` values,
 * which is fine. The gap is that nothing prevents a maintainer from
 * accidentally putting a real Coturn password in `NEXT_PUBLIC_TURN_PASS`
 * and shipping it. This test makes the leak observable at PR time rather
 * than at incident time.
 *
 * Three contracts:
 *
 *   A. No committed source file contains an inline `turn:`/`turns:` URL
 *      whose query string carries a `username=` or `credential=`
 *      parameter. The inline form would be inlined into the client
 *      bundle verbatim by Next.js's `NEXT_PUBLIC_*` resolution.
 *
 *   B. The committed `.env.example` only references `NEXT_PUBLIC_TURN_PASS`
 *      as either (a) absent (commented out), (b) empty, or (c) the literal
 *      public-fallback `openrelayproject`. Any other value is treated as
 *      a committed private credential.
 *
 *   C. Reference lookups via `process.env.NEXT_PUBLIC_TURN_*` do not
 *      trigger the guard — only committed string-literal values do.
 *
 * Files intentionally embedding the public OpenRelay fallback are
 * allowlisted (object-form credentials, not inline URL credentials):
 *   - src/lib/ice-config.ts
 *
 * The companion Node script `scripts/check-turn-credentials.mjs` runs
 * the same checks against the live repo in a dedicated CI job
 * (`.github/workflows/ci.yml → turn-credentials-guard`). This test
 * exercises the same contracts in plain Jest so a regression also fails
 * the standard `npm test` run.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const ENV_EXAMPLE = path.join(REPO_ROOT, ".env.example");

// Source files allowlisted for the inline-URL credential check. These
// intentionally embed the public OpenRelay fallback in object form (not
// inline URL form) and the public-fallback credential string itself is
// intentionally committed. The test files in `src/lib/__tests__/` are
// also allowlisted because they legitimately contain synthetic test
// fixtures (URLs, env-var assignments) that exercise the detection logic
// — failing the test on those would make the guard self-defeating.
const INLINE_URL_ALLOWLIST = new Set<string>([
  path.join("src", "lib", "ice-config.ts"),
  path.join("src", "lib", "__tests__", "ice-config.credential-leak.test.ts"),
]);

// Subdirectories we never descend into. The standard noise block keeps
// the walk fast (<2s, per the issue acceptance criteria) so this test
// is cheap enough to live in the default `npm test` suite.
const SKIP_DIRS = new Set<string>([
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".git",
  "coverage",
  "test-results",
]);

// File extensions considered source for the inline-URL scan. Binary
// files (images, fonts, etc.) are excluded; so is Rust (src-tauri/ is
// walked by the companion Node script, not here).
const SOURCE_EXTENSIONS = new Set<string>([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".md",
]);

// Inline TURN URL credential pattern. Matches `turn:`/`turns:` URLs
// whose query string contains a `username=` or `credential=` parameter.
const TURN_URL_CRED_PATTERN =
  /(?:^|[^A-Za-z0-9_])(?:turn|turns):[^\s'",;)<>\\]*[?&](?:username|credential)=/gi;

/** Literal public OpenRelay fallback credential. The only non-empty
 * value permitted for `NEXT_PUBLIC_TURN_PASS` in `.env.example` because
 * the same value is intentionally shipped in
 * `PUBLIC_FALLBACK_TURN_SERVERS` (src/lib/ice-config.ts:84-103). */
const PUBLIC_FALLBACK_CRED = "openrelayproject";

/**
 * Recursively walk `dir`, collecting every regular file path. Honours
 * {@link SKIP_DIRS} at every level.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

interface InlineCredentialMatch {
  file: string;
  line: number;
  match: string;
}

/** Find inline TURN URL credentials in a single source file. */
function findInlineCredentials(file: string): InlineCredentialMatch[] {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const matches: InlineCredentialMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    TURN_URL_CRED_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TURN_URL_CRED_PATTERN.exec(lines[i])) !== null) {
      matches.push({
        file: path.relative(REPO_ROOT, file),
        line: i + 1,
        match: m[0],
      });
    }
  }
  return matches;
}

describe("Issue #1571 — committed TURN credential leak guard", () => {
  // -------------------------------------------------------------------
  // Contract A: no source file commits an inline TURN URL credential.
  // -------------------------------------------------------------------
  describe("contract A: no source file commits an inline turn:/turns: URL credential", () => {
    let allSourceFiles: string[];

    beforeAll(() => {
      // Single filesystem walk — reused by every contract-A test. Keeping
      // the walk scoped to `src/` keeps the test well under the 2-second
      // budget documented in the issue acceptance criteria.
      allSourceFiles = walk(SRC_DIR).filter((f) =>
        SOURCE_EXTENSIONS.has(path.extname(f).toLowerCase()),
      );
    });

    it("scans at least the canonical TURN source file (smoke)", () => {
      // Sanity check: the walk covered the single source of truth for
      // TURN resolution. If this fails, the walk logic has drifted
      // (e.g. SKIP_DIRS got a typo) and the rest of contract A is
      // meaningless.
      expect(allSourceFiles.length).toBeGreaterThan(0);
      const iceConfig = path.join(REPO_ROOT, "src", "lib", "ice-config.ts");
      expect(allSourceFiles).toContain(iceConfig);
    });

    it("PUBLIC_FALLBACK_TURN_SERVERS uses object fields, not inline URL credentials (regression)", () => {
      // Regression: the public OpenRelay fallback must use the object
      // form (`{ urls, username, credential, credentialType }`), NOT
      // inline `?username=&credential=` query params. If a future
      // contributor rewrites the constant to embed credentials in the
      // URL string itself, this test fails loudly — inline URL
      // credentials ship verbatim into the client bundle and are the
      // #1571 leak vector.
      const iceConfig = fs.readFileSync(
        path.join(REPO_ROOT, "src", "lib", "ice-config.ts"),
        "utf8",
      );
      expect(iceConfig).toContain("PUBLIC_FALLBACK_TURN_SERVERS");
      expect(iceConfig).toContain(PUBLIC_FALLBACK_CRED);
      // Re-run the inline-credential regex against the file; it must
      // find zero matches (object form only).
      expect(TURN_URL_CRED_PATTERN.test(iceConfig)).toBe(false);
      // Reset lastIndex because we used the global regex with `.test`.
      TURN_URL_CRED_PATTERN.lastIndex = 0;
    });

    it("no source file contains an inline turn:/turns: URL with username=/credential= query params", () => {
      const violations: InlineCredentialMatch[] = [];
      for (const file of allSourceFiles) {
        const rel = path.relative(REPO_ROOT, file);
        if (INLINE_URL_ALLOWLIST.has(rel)) continue;
        const matches = findInlineCredentials(file);
        for (const m of matches) {
          violations.push(m);
        }
      }
      if (violations.length > 0) {
        // Surface the file + line in the failure message so the
        // contributor can fix the leak without re-running with extra
        // logging.
        const summary = violations
          .map((v) => `  ${v.file}:${v.line}: ${v.match.trim()}`)
          .join("\n");
        throw new Error(
          `Inline TURN URL credentials detected (#1571):\n${summary}`,
        );
      }
      expect(violations).toEqual([]);
    });

    it("synthetic non-OpenRelay URL with inline credential is detected by the regex (fixture contract)", () => {
      // Fixture: synthesise a string containing a leak and assert the
      // regex flags it. This pins the detection capability of the
      // guard so future regex tweaks that weaken it fail this test.
      const leaked =
        "const TURN: ICEServerConfig = {\n" +
        "  urls: 'turn:coturn.example.com:3478?username=alice&credential=myRealSecretPassword',\n" +
        "  credentialType: 'password',\n" +
        "};\n";
      const matches: InlineCredentialMatch[] = [];
      const lines = leaked.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        TURN_URL_CRED_PATTERN.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = TURN_URL_CRED_PATTERN.exec(lines[i])) !== null) {
          matches.push({ line: i + 1, file: "<fixture>", match: m[0] });
        }
      }
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].match).toMatch(/username=/);
      expect(matches[0].match).toMatch(/credential=/);
    });
  });

  // -------------------------------------------------------------------
  // Contract B: `.env.example` never commits a real NEXT_PUBLIC_TURN_PASS.
  // -------------------------------------------------------------------
  describe("contract B: .env.example never commits a real NEXT_PUBLIC_TURN_PASS value", () => {
    let envExampleText: string;

    beforeAll(() => {
      envExampleText = fs.readFileSync(ENV_EXAMPLE, "utf8");
    });

    it(".env.example exists at the repo root", () => {
      expect(fs.existsSync(ENV_EXAMPLE)).toBe(true);
    });

    it("every uncommented NEXT_PUBLIC_TURN_PASS line is empty or 'openrelayproject'", () => {
      // Per the issue acceptance criteria: any line matching
      // `^NEXT_PUBLIC_TURN_PASS=` either (a) is absent (commented out
      // — starts with `#`), (b) is empty, or (c) equals the literal
      // public fallback. Commented-out lines are skipped because the
      // current `.env.example` uses the placeholder convention
      // `# NEXT_PUBLIC_TURN_PASS=your-credential` — comments document
      // the variable without committing it.
      const lines = envExampleText.split(/\r?\n/);
      const assignments: { line: number; value: string }[] = [];
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        // Skip commented-out lines (the current placeholder convention).
        if (/^\s*#/.test(raw)) continue;
        const m = /^NEXT_PUBLIC_TURN_PASS\s*=\s*(.*?)\s*$/.exec(raw.trim());
        if (!m) continue;
        const value = m[1].replace(/^["']|["']$/g, "");
        assignments.push({ line: i + 1, value });
      }
      for (const a of assignments) {
        expect([PUBLIC_FALLBACK_CRED, ""]).toContain(a.value);
      }
    });

    it(".env.example currently uses commented-out placeholders (current repo state)", () => {
      // Pins the existing convention so a future contributor who
      // uncomments the placeholder line with a real value trips
      // contract B above. The line numbers are not asserted (the file
      // may grow), only the presence of at least one commented-out
      // `NEXT_PUBLIC_TURN_*` placeholder.
      const lines = envExampleText.split(/\r?\n/);
      const commentedPlaceholders = lines.filter((l) =>
        /^\s*#\s*NEXT_PUBLIC_TURN_/.test(l),
      );
      expect(commentedPlaceholders.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------
  // Contract C: reference lookups via process.env are not flagged.
  // -------------------------------------------------------------------
  describe("contract C: process.env.NEXT_PUBLIC_TURN_* reference lookups are not flagged", () => {
    it("'process.env.NEXT_PUBLIC_TURN_PASS' alone does not match the inline URL pattern", () => {
      // Regression: the inline-URL pattern must NOT fire on the
      // read-side accessor `process.env.NEXT_PUBLIC_TURN_PASS`. If a
      // future regex tweak broadens the match to catch this string,
      // every legitimate reference lookup in the codebase would
      // become a violation.
      const reference = "const pass = process.env.NEXT_PUBLIC_TURN_PASS;";
      const m = TURN_URL_CRED_PATTERN.exec(reference);
      expect(m).toBeNull();
    });

    it("src/lib/ice-config.ts reads NEXT_PUBLIC_TURN_* via the env parameter (the read path), not hardcoded values", () => {
      // Pins the canonical TURN source as a read-only consumer of the
      // NEXT_PUBLIC_TURN_* env vars. `resolveTurnServers` accepts an
      // `env: TurnEnvRecord` parameter (defaulting to `process.env`),
      // so the read path uses `env.NEXT_PUBLIC_TURN_*` rather than the
      // literal `process.env.NEXT_PUBLIC_TURN_*` accessor. If a
      // contributor switches the module to inline the credentials at
      // compile time, this test fails before the leak reaches a real
      // browser.
      const iceConfig = fs.readFileSync(
        path.join(REPO_ROOT, "src", "lib", "ice-config.ts"),
        "utf8",
      );
      // `resolveTurnServers` is the only read path; assert each of the
      // three NEXT_PUBLIC_TURN_* keys is referenced via the `env.`
      // accessor (which falls back to `process.env` per the parameter
      // default) and not assigned a hardcoded literal.
      expect(iceConfig).toMatch(/env\.NEXT_PUBLIC_TURN_URL/);
      expect(iceConfig).toMatch(/env\.NEXT_PUBLIC_TURN_USER/);
      expect(iceConfig).toMatch(/env\.NEXT_PUBLIC_TURN_PASS/);
      // Regression: ensure the module does NOT commit a hardcoded
      // string literal to any of the three keys (which would be the
      // exact #1571 leak vector — inlined into the client bundle).
      expect(iceConfig).not.toMatch(
        /NEXT_PUBLIC_TURN_(?:URL|USER|PASS)\s*(?::=|=|:)\s*['"`]/,
      );
    });
  });
});
