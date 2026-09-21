/**
 * @fileoverview Tests for the browser-only saved-game-serialize factory
 * (issue #1912).
 *
 * The factory file (`saved-game-serialize-factory.ts`) captures
 * `import.meta.url` at module top-level, which is unparseable under
 * ts-jest CommonJS — Node's CJS loader refuses the `import.meta`
 * token with "Must use import to load ES Module". The client loads
 * the factory via a dynamic `import()` wrapped in try/catch, so a
 * thrown error here is the EXPECTED production contract — these
 * tests pin that contract.
 *
 * Coverage:
 *   (a) Loading the factory via `require()` from jsdom throws the
 *       ESM-syntax error that the client must catch. This is the
 *       exact failure mode the dynamic-import try/catch in
 *       `saved-game-serialize-client.ts` was written to handle.
 *   (b) Source-level regression guards for the exact issue #1912
 *       patterns: no `new Function(...)` helper that reaches across
 *       realms to grab `import.meta`, and a top-level
 *       `new URL(import.meta.url)` capture is present.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FACTORY_PATH = join(__dirname, "..", "saved-game-serialize-factory.ts");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("saved-game-serialize-factory (issue #1912)", () => {
  describe("factory load contract under ts-jest CJS", () => {
    it("throws an ESM-syntax error when require()'d in jsdom (production catch handles it)", () => {
      let thrown: unknown = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../saved-game-serialize-factory");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).not.toBeNull();
      expect(typeof thrown).toBe("object");
      expect(typeof (thrown as { name?: unknown }).name).toBe("string");
      expect(typeof (thrown as { message?: unknown }).message).toBe("string");
      expect((thrown as Error).message).toMatch(/import|module/i);
    });
  });

  describe("regression guards for the issue #1912 patterns", () => {
    it("factory source does NOT use the broken `new Function('... import.meta ...')` pattern", () => {
      const code = stripComments(readFileSync(FACTORY_PATH, "utf8"));
      expect(code).not.toMatch(/new\s+Function\s*\(/);
    });

    it("factory source uses top-level `new URL(import.meta.url)` capture", () => {
      const code = stripComments(readFileSync(FACTORY_PATH, "utf8"));
      expect(code).toMatch(/new\s+URL\s*\(\s*import\.meta\.url\s*\)/);
    });

    it("factory source resolves the worker URL with the static-analysis-friendly shape", () => {
      const code = stripComments(readFileSync(FACTORY_PATH, "utf8"));
      expect(code).toMatch(
        /new\s+URL\s*\(\s*['"]\.\/saved-game-serialize\.worker\.ts['"]\s*,\s*MODULE_URL\s*\)\s*\.href/,
      );
    });
  });
});
