/**
 * Integration tests for the issue #1815 jest-mock boundary guard
 * (`scripts/check-jest-mock-boundary.mjs`).
 *
 * Mirrors the test pattern of `tests/mutation-docs-guard.test.ts` (#1785)
 * and `tests/coverage-docs-guard.test.ts` (#1712): the guard is a plain
 * Node script invoked by CI in its own job (`jest-mock-boundary-guard`,
 * wired to `npm run lint:jest-mock-boundary`). These tests spawn `node`
 * against the committed repo state (must PASS) and against fixture
 * directories (must FAIL when a deep engine mock sneaks back in, must
 * PASS when an allowlist entry is present).
 *
 * Contract summary (from issue #1815 acceptance criterion):
 *   - A `jest.mock("@/lib/game-state/<submodule>")` outside the engine
 *     tree MUST fail unless the file is in the allowlist.
 *   - A dynamic `import("@/lib/game-state/<submodule>")` outside the
 *     engine tree MUST fail (issue #1815 calls these out — inline
 *     `import("path").Type` qualifiers in type positions are also caught).
 *   - The barrel itself `@/lib/game-state` (no `/<submodule>`) MUST pass.
 *   - Engine-internal tests under `src/lib/game-state/**` are exempt by
 *     construction (they ARE the engine).
 *   - The committed repo state MUST pass — this is the state CI gates on.
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-jest-mock-boundary.mjs");

interface GuardResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGuard(args: string[] = []): GuardResult {
  const proc = cp.spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf-8",
    cwd: REPO_ROOT,
  });
  return {
    code: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

describe("jest-mock-boundary guard (issue #1815)", () => {
  jest.setTimeout(60_000);

  it("passes on the committed repo state (CI baseline)", () => {
    const result = runGuard();
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/jest-mock-boundary: OK/);
  });

  it("--list prints the allowlisted files with their reasons", () => {
    const result = runGuard(["--list"]);
    expect(result.code).toBe(0);
    // Every allowlisted file from config/jest-mock-boundary-allowlist.json
    // should appear with a non-empty reason.
    expect(result.stdout).toContain("ai-action-executor.test.ts");
    expect(result.stdout).toContain("ai-turn-loop.test.ts");
    expect(result.stdout).toContain("ai-turn-loop-worker.test.ts");
    expect(result.stdout).toContain("block-prediction.test.ts");
    expect(result.stdout).toContain("p2p-handshake.test.ts");
    expect(result.stdout).toContain("p2p-session-key-forgery.test.ts");
  });
});

describe("jest-mock-boundary guard (issue #1815) — synthetic fixtures", () => {
  jest.setTimeout(60_000);

  /**
   * Build a tiny throwaway project under `tmp` that mimics the real repo
   * shape well enough for the guard's file collection. Returns the
   * tmp root and a `cleanup` thunk. We rewrite `process.cwd` only by
   * passing `cwd` to `spawnSync`, so other tests aren't affected.
   */
  function makeTmpRepo(): { root: string; cleanup: () => void } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jest-mock-bound-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "lib", "game-state", "__tests__"), {
      recursive: true,
    });
    // Touch an engine file inside the engine tree so the directory has
    // at least one .ts file — otherwise collectTestFiles() returns empty
    // and the guard reports OK trivially.
    fs.writeFileSync(
      path.join(root, "src", "lib", "game-state", "engine.ts"),
      "export const x = 1;\n",
    );
    // Engine-internal test (must NOT be flagged).
    fs.writeFileSync(
      path.join(
        root,
        "src",
        "lib",
        "game-state",
        "__tests__",
        "engine.test.ts",
      ),
      'jest.mock("./serialization");\n',
    );
    return {
      root,
      cleanup: () => {
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  }

  /** Stage a single .ts file under a chosen repo-relative path. */
  function stage(root: string, relPath: string, body: string): void {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }

  /**
   * Symlink the script + tsconfig + node_modules so the guard's
   * `import ts from "typescript"` resolves in the temp repo. Without
   * node_modules, the script crashes at import time and the test
   * result is meaningless.
   */
  function linkDeps(root: string): void {
    // Symlink `node_modules` so the script's `import ts from "typescript"`
    // resolves. (The script also imports `node:fs` / `node:path` / etc.
    // — those are built-in, no resolution needed.)
    fs.symlinkSync(
      path.join(REPO_ROOT, "node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    // Symlink the script + the config dir so the script's relative paths
    // (`config/jest-mock-boundary-allowlist.json`) work in the temp repo.
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.symlinkSync(
      SCRIPT,
      path.join(root, "scripts", "check-jest-mock-boundary.mjs"),
      "file",
    );
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    // Empty allowlist (no permitted deep mocks) — tests that need
    // entries write their own.
    fs.writeFileSync(
      path.join(root, "config", "jest-mock-boundary-allowlist.json"),
      JSON.stringify({ files: {} }, null, 2),
    );
  }

  function runInTmp(root: string, args: string[] = []): GuardResult {
    // Symlinked script locations make `import.meta.url` resolve to the
    // ORIGINAL file path (not the symlink), so the script's auto-derived
    // REPO_ROOT would point at the test runner's checkout instead of
    // this temp repo. The script honours JEST_MOCK_BOUNDARY_REPO_ROOT
    // for exactly this reason — tests must set it to make synthetic
    // fixtures work.
    const proc = cp.spawnSync(
      process.execPath,
      [path.join(root, "scripts", "check-jest-mock-boundary.mjs"), ...args],
      {
        encoding: "utf-8",
        cwd: root,
        env: {
          ...process.env,
          JEST_MOCK_BOUNDARY_REPO_ROOT: root,
        },
      },
    );
    return {
      code: proc.status ?? -1,
      stdout: proc.stdout ?? "",
      stderr: proc.stderr ?? "",
    };
  }

  it("flags a bare jest.mock deep-engine path outside the engine tree", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "src/ai/__tests__/executor.test.ts",
        [
          'jest.mock("@/lib/game-state/mana");',
          'jest.mock("@/lib/game-state/spell-casting");',
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("jest-mock-boundary: FAILED");
      expect(result.stderr).toContain('mock("@/lib/game-state/mana")');
      expect(result.stderr).toContain('mock("@/lib/game-state/spell-casting")');
    } finally {
      cleanup();
    }
  });

  it("flags a dynamic import() deep-engine path outside the engine tree", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "src/ai/decision-making/__tests__/predictor.test.ts",
        [
          "function fixture(): import('@/lib/game-state/types').Foo {",
          "  return null as never;",
          "}",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("jest-mock-boundary: FAILED");
      // The 'import-type' helper-name is how the guard labels inline
      // type-qualifier forms.
      expect(result.stderr).toContain('import-type("@/lib/game-state/types")');
    } finally {
      cleanup();
    }
  });

  it("accepts the barrel @/lib/game-state with no submodule suffix", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "src/ai/__tests__/executor.test.ts",
        [
          // Two valid forms: bare barrel specifier, and barrel with empty
          // suffix — both must pass.
          'jest.mock("@/lib/game-state");',
          "const _type: import('@/lib/game-state').PublicType = 0;",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/jest-mock-boundary: OK/);
    } finally {
      cleanup();
    }
  });

  it("exempts engine-internal tests (src/lib/game-state/__tests__/**)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      // The makeTmpRepo fixture already created src/lib/game-state/__tests__/engine.test.ts
      // with jest.mock("./serialization"). That file lives inside the
      // engine tree, so the guard must exempt it by construction — no
      // allowlist entry needed.
      const result = runInTmp(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/jest-mock-boundary: OK/);
    } finally {
      cleanup();
    }
  });

  it("honours an allowlist entry for a file that legitimately deep-mocks", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      const guardedFile = "src/ai/__tests__/executor-with-allowlist.test.ts";
      stage(root, guardedFile, 'jest.mock("@/lib/game-state/mana");\n');
      // Add an allowlist entry for the staged file.
      fs.writeFileSync(
        path.join(root, "config", "jest-mock-boundary-allowlist.json"),
        JSON.stringify({
          files: {
            [guardedFile]: {
              reason:
                "Executor's dispatch is the unit under test; mana mutator is stubbed.",
            },
          },
        }),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/jest-mock-boundary: OK/);
    } finally {
      cleanup();
    }
  });

  it("rejects a malformed allowlist file (shape mismatch) with exit 1", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      // Allowlist must be { files: { ... } } — anything else is a
      // structural problem the guard surfaces loudly so a typo doesn't
      // silently disable enforcement.
      fs.writeFileSync(
        path.join(root, "config", "jest-mock-boundary-allowlist.json"),
        JSON.stringify({ notFiles: {} }),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/malformed allowlist/);
    } finally {
      cleanup();
    }
  });
});
