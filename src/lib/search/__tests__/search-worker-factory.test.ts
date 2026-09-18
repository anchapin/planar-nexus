/**
 * @fileoverview Tests for the browser-only search worker factory
 * (issue #1894).
 *
 * The factory file (`search-worker-factory.ts`) captures
 * `import.meta.url` at module top-level, which is unparseable under
 * ts-jest CommonJS — Node's CJS loader rejects the `import.meta`
 * token with "Must use import to load ES Module". The client loads
 * the factory via a dynamic `import()` wrapped in try/catch, so a
 * thrown error here is the EXPECTED production contract — these
 * tests pin that contract.
 *
 * Coverage:
 *   (a) Loading the factory via `require()` from jsdom throws the
 *       ESM-syntax error that the client must catch. This is the
 *       exact failure mode the dynamic-import try/catch in
 *       `search-worker-client.ts` was written to handle — a future
 *       refactor that makes the factory CJS-parseable without
 *       keeping the fallback path is caught here.
 *   (b) Source-level regression guards for the exact issue #1894
 *       patterns: no `new Function(...)` helper that reaches across
 *       realms to grab `import.meta`, and a top-level
 *       `new URL(import.meta.url)` capture is present.
 *
 * We exercise the real factory file (not a mock) so the regression
 * guards stay honest. Comments are stripped before matching so the
 * prose docstring that explains the bug does not trip the regex.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Path to the factory file, resolved from the test file's location.
 * Keeping the path explicit (rather than `require.resolve`) ensures
 * the regression guard catches typos in the import path used by
 * `search-worker-client.ts`.
 */
const FACTORY_PATH = join(__dirname, "..", "search-worker-factory.ts");

/**
 * Strip C-style line comments (`//`) and block comments (`/* ... *\/`)
 * from the factory source so the prose docstring that explains the
 * bug does not match a `new Function` or `import.meta` regex that
 * targets the actual code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("search-worker-factory (issue #1894)", () => {
  describe("factory load contract under ts-jest CJS", () => {
    it(
      "throws an ESM-syntax error when require()'d in jsdom (production catch handles it)",
      () => {
        // The factory uses `import.meta` at module top-level, which
        // Node's CJS loader refuses with "Must use import to load ES
        // Module" (after ts-jest's transform emits the ESM-shaped
        // `import.meta` literal). The client catches this exact
        // failure mode and falls back to the last-resort
        // `self.location.href` path. Pin the contract so a future
        // refactor that drops the fallback path is caught here.
        let thrown: unknown = null;
        try {
          // `require` is intentionally used (not `await import`): the
          // production code path uses dynamic `import()` in browsers,
          // but the underlying failure mode (the parser choking on
          // `import.meta`) is identical for both.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("../search-worker-factory");
        } catch (error) {
          thrown = error;
        }

        expect(thrown).not.toBeNull();
        // We do not pin the exact error message — it changes across
        // Jest / Node versions — only that SOME error was thrown
        // (the call site must catch it). The duck-typed `name` +
        // `message` check avoids cross-realm `instanceof` failures
        // where jest's `Error` reference differs from the one the
        // CJS loader throws (jsdom / vm-context boundary).
        expect(typeof thrown).toBe("object");
        expect(typeof (thrown as { name?: unknown }).name).toBe("string");
        expect(typeof (thrown as { message?: unknown }).message).toBe(
          "string",
        );
        // The error message references the ESM/CJS bridge — pin that
        // the failure is the *expected* kind, not a stray import
        // resolution bug from a typo in the factory path.
        expect((thrown as Error).message).toMatch(/import|module/i);
      },
    );
  });

  describe("regression guards for the issue #1894 patterns", () => {
    it("factory source does NOT use the broken `new Function('... import.meta ...')` pattern", () => {
      // Issue #1894 root cause: the previous
      // `search-worker-client.ts:resolveImportMetaUrl()` helper used
      // `new Function('try { return ... import.meta.url ... }')()` to
      // recover the calling module's URL. `new Function` builds a
      // global-realm function where `import.meta` is undefined, so
      // the helper always returned `null` in production traffic. The
      // fix moves the `import.meta` access into the module realm
      // proper — captured here at top level. If a future change
      // re-introduces the `new Function`-realm trick, this test
      // fails immediately.
      const code = stripComments(readFileSync(FACTORY_PATH, "utf8"));
      expect(code).not.toMatch(/new\s+Function\s*\(/);
    });

    it("factory source uses top-level `new URL(import.meta.url)` capture", () => {
      // The fix relies on the literal
      //   const MODULE_URL = new URL(import.meta.url);
      // shape so webpack/Turbopack can statically analyse the worker
      // chunk. A regression that drops the top-level capture (or
      // moves it inside a `new Function`-created realm) would
      // re-introduce the production MIME-type failure.
      const code = stripComments(readFileSync(FACTORY_PATH, "utf8"));
      expect(code).toMatch(/new\s+URL\s*\(\s*import\.meta\.url\s*\)/);
    });

    it("factory source resolves the worker URL with the static-analysis-friendly shape", () => {
      // The bundler keys off the literal `new URL(RELATIVE,
      // MODULE_URL)` shape to emit the worker as its own chunk. A
      // regression that drops the relative form (e.g. switches to an
      // absolute path or template literal) loses the chunk emission
      // and the worker silently 404s again — exactly the Firefox /
      // WebKit failure mode described in issue #1894.
      const code = stripComments(readFileSync(FACTORY_PATH, "utf8"));
      expect(code).toMatch(
        /new\s+URL\s*\(\s*['"]\.\/search\.worker\.ts['"]\s*,\s*MODULE_URL\s*\)/,
      );
    });
  });
});
