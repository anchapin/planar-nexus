/**
 * Engine import-boundary guard — issue #1724.
 *
 * The rules engine (src/lib/game-state/**) must be self-contained: no
 * import inside the engine may resolve outside it (vendored/third-party
 * excepted). The boundary is enforced by the sibling `no-restricted-imports`
 * blocks in eslint.config.mjs (see also the #1710 barrel rule). This suite
 * pins the enforcement itself: each case lints a snippet AS IF it lived at
 * a specific path (eslint --stdin --stdin-filename) and asserts the rule
 * fires (or stays silent) exactly as the boundary contract demands.
 *
 * If this suite fails after an eslint.config.mjs edit, the engine boundary
 * enforcement regressed — fix the config, not this test.
 */
import { execFileSync } from "child_process";
import { resolve } from "path";

// eslint's exports map hides `bin/eslint.js` from require.resolve, so
// locate it via the package manifest's `bin` field (string or {name:path}).
const ESLINT_PKG = require.resolve("eslint/package.json");
const eslintManifest = require(ESLINT_PKG) as {
  bin: string | Record<string, string>;
};
const eslintBinPath =
  typeof eslintManifest.bin === "string"
    ? eslintManifest.bin
    : eslintManifest.bin.eslint;
const ESLINT_BIN = resolve(ESLINT_PKG, "..", eslintBinPath);
const REPO_ROOT = resolve(__dirname, "..");

interface LintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
}

interface LintResult {
  errorCount: number;
  messages: LintMessage[];
}

/**
 * Lint `code` as though it were a file at `filename` (relative to the
 * repo root) and return the messages reported for it. ESLint exits 1
 * when it reports errors — that is a finding, not a harness failure, so
 * only exit codes other than 0/1 are fatal here.
 */
function lintAs(filename: string, code: string): LintMessage[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      process.execPath,
      [
        ESLINT_BIN,
        "--stdin",
        "--stdin-filename",
        filename,
        "--format",
        "json",
        "--no-warn-ignored",
      ],
      { cwd: REPO_ROOT, input: code, encoding: "utf8", timeout: 90_000 },
    );
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    // execFileSync failures carry the child exit code on `status`;
    // status 1 = "lint errors found" (the expected finding path).
    if (err.status === 1 && typeof err.stdout === "string") {
      stdout = err.stdout;
    } else {
      throw error;
    }
  }
  const results = JSON.parse(stdout) as LintResult[];
  return results[0]?.messages ?? [];
}

function boundaryErrors(filename: string, code: string): LintMessage[] {
  return lintAs(filename, code).filter(
    (m) => m.ruleId === "no-restricted-imports" && m.severity === 2,
  );
}

const ENGINE_ROOT_FILE = "src/lib/game-state/validation-service.ts";
const ENGINE_DEPTH1_FILE = "src/lib/game-state/types/cards.ts";
const ENGINE_DEPTH2_FILE = "src/lib/game-state/__tests__/families/fixture.ts";
const OUTSIDE_FILE = "src/lib/p2p-game-connection.ts";

describe("engine import boundary (#1724) eslint enforcement", () => {
  jest.setTimeout(180_000);

  it("errors on the historical outbound import: @/lib/game-rules", () => {
    const errors = boundaryErrors(
      ENGINE_ROOT_FILE,
      'import { getGameMode } from "@/lib/game-rules";\nexport const x = getGameMode;\n',
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((m) => m.message.includes("format-rules.ts"))).toBe(
      true,
    );
  });

  it("errors on @/lib/card-database — even for type-only imports", () => {
    const errors = boundaryErrors(
      ENGINE_ROOT_FILE,
      'import type { ScryfallCard } from "@/lib/card-database";\nexport type X = ScryfallCard;\n',
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((m) => m.message.includes("card-data.ts"))).toBe(true);
  });

  it("errors on non-lib aliases like @/components inside the engine", () => {
    const errors = boundaryErrors(
      ENGINE_ROOT_FILE,
      'import { Button } from "@/components/ui/button";\nexport const B = Button;\n',
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("errors on relative escapes from the engine root (../x)", () => {
    const errors = boundaryErrors(
      ENGINE_ROOT_FILE,
      'import { thing } from "../game-rules";\nexport const t = thing;\n',
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("errors on relative escapes from depth-1 files (../../x)", () => {
    const errors = boundaryErrors(
      ENGINE_DEPTH1_FILE,
      "import { thing } from '../../game-rules';\nexport const t = thing;\n",
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("errors on relative escapes from depth-2 files (../../../x)", () => {
    const errors = boundaryErrors(
      ENGINE_DEPTH2_FILE,
      "import { thing } from '../../../game-rules';\nexport const t = thing;\n",
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("allows intra-engine relative and own-barrel imports", () => {
    expect(
      boundaryErrors(
        ENGINE_ROOT_FILE,
        [
          'import { getGameMode } from "./format-rules";',
          'import type { ScryfallCard } from "./types";',
          'import { isLand } from "@/lib/game-state";',
          "export const g = getGameMode;",
        ].join("\n") + "\n",
      ),
    ).toHaveLength(0);
  });

  it("allows vendored/third-party imports inside the engine", () => {
    expect(
      boundaryErrors(
        ENGINE_ROOT_FILE,
        'import { isEqual } from "es-toolkit";\nexport const eq = isEqual;\n',
      ),
    ).toHaveLength(0);
  });

  it("allows legitimate depth-2 ../../ intra-engine imports (families pattern)", () => {
    expect(
      boundaryErrors(
        ENGINE_DEPTH2_FILE,
        "import * as fam0 from '../../keyword-actions/blitz';\nexport const f = fam0;\n",
      ),
    ).toHaveLength(0);
  });

  it("still enforces the #1710 barrel rule outside the engine", () => {
    // Barrel import: fine.
    expect(
      boundaryErrors(
        OUTSIDE_FILE,
        'import { isLand } from "@/lib/game-state";\nexport const l = isLand;\n',
      ),
    ).toHaveLength(0);
    // Deep engine import outside the engine: still an error (#1710).
    expect(
      boundaryErrors(
        OUTSIDE_FILE,
        'import { types } from "@/lib/game-state/types";\nexport const t = types;\n',
      ),
    ).toMatchObject([{ ruleId: "no-restricted-imports" }]);
  });
});
