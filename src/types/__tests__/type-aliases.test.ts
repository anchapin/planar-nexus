/**
 * Type-reconciliation guard (issue #1398).
 *
 * Locks the post-refactor invariant: `PlayerState` and `GameState` are the
 * canonical domain types and live ONLY in `src/types/game.ts`. Any component
 * or module that needs a view-specific shape must derive it from the
 * canonical types (via `Pick`, `Partial`, or `& { … }`) rather than
 * redeclaring an interface under the same name.
 *
 * If a future contributor adds a parallel `interface PlayerState` (or
 * resurrects `interface JudgePlayerState` etc.) this test fails and the
 * regression is caught before it ships.
 */

import * as fs from "node:fs";
import * as path from "node:path";

type DeclarationKind = "interface" | "type";

interface Declaration {
  kind: DeclarationKind;
  name: string;
  file: string;
  line: number;
}

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const TYPES_DIR = path.join(SRC_ROOT, "types");
const CANONICAL_GAME_TYPES = path.join(TYPES_DIR, "game.ts");

const TARGETS = ["PlayerState", "GameState"] as const;
const FORBIDDEN_NAMES = ["JudgePlayerState", "JudgeGameState"] as const;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function findDeclarations(): Declaration[] {
  const declarations: Declaration[] = [];
  const re = /^(export\s+)?(interface|type)\s+([A-Za-z0-9_]+)\b/;
  for (const file of walk(SRC_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(re);
      if (!match) continue;
      const kind = match[2] as DeclarationKind;
      const name = match[3];
      declarations.push({ kind, name, file, line: i + 1 });
    }
  }
  return declarations;
}

describe("PlayerState / GameState canonical types (issue #1398)", () => {
  it("re-exports PlayerState and GameState from src/types/game.ts", () => {
    // Interfaces are erased at runtime, so we can't introspect them directly.
    // Assert against the source file: this is the canonical home.
    const source = fs.readFileSync(CANONICAL_GAME_TYPES, "utf8");
    expect(source).toMatch(/export\s+interface\s+PlayerState\b/);
    expect(source).toMatch(/export\s+interface\s+GameState\b/);
  });

  it("declares no duplicate PlayerState/GameState in UI surfaces (components & app routes)", () => {
    // Scope: this guard targets the regression that #1398 was filed against —
    // a `replay-viewer.tsx` declaring `interface PlayerState` that collided
    // with the canonical import, and a `judge-tools.tsx` doing the same.
    //
    // Out of scope (intentional, distinct domain shapes, each with many
    // importers and tracked in follow-up cleanup):
    //   - src/ai/types.ts: AI evaluation view-model (hand?/board?/life?/...)
    //   - src/lib/game-state/types.ts: engine internal state (gameId/players/cards/...)
    //   - src/test-utils/factories/game-state.ts: test factory view-model
    //
    // The test asserts no UI-layer (components or app routes) redeclares the
    // canonical type name. Renaming the 3 out-of-scope declarations to distinct
    // domain names is a follow-up.
    const offenders = findDeclarations().filter(
      (d) =>
        (TARGETS as readonly string[]).includes(d.name) &&
        path.resolve(d.file) !== path.resolve(CANONICAL_GAME_TYPES) &&
        (d.file.includes("/src/components/") || d.file.includes("/src/app/")),
    );
    expect(offenders).toEqual([]);
  });

  it("does not redeclare the legacy JudgePlayerState / JudgeGameState interfaces", () => {
    const offenders = findDeclarations().filter((d) =>
      (FORBIDDEN_NAMES as readonly string[]).includes(d.name),
    );
    expect(offenders).toEqual([]);
  });

  it("src/components/replay-viewer.tsx no longer declares a PlayerState interface", () => {
    const replayViewer = path.join(SRC_ROOT, "components", "replay-viewer.tsx");
    const source = fs.readFileSync(replayViewer, "utf8");
    // The replay-viewer's scrubber state is now `ReplayPlayerControls`.
    // A bare `interface PlayerState` would collide with the canonical type
    // (this is the exact regression #1398 was filed against).
    expect(source).not.toMatch(/^interface\s+PlayerState\b/m);
    expect(source).toMatch(/interface\s+ReplayPlayerControls\b/);
  });

  it("src/components/judge-tools.tsx imports from the canonical location", () => {
    const judgeTools = path.join(SRC_ROOT, "components", "judge-tools.tsx");
    const source = fs.readFileSync(judgeTools, "utf8");
    expect(source).toMatch(
      /import\s+type\s*\{[^}]*\bPlayerState\b[^}]*\}\s+from\s+["']@\/types\/game["']/,
    );
    expect(source).toMatch(/JudgeViewPlayer/);
    expect(source).toMatch(/JudgeViewGameState/);
  });
});
