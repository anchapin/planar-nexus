/**
 * Integration tests for the issue #1571 TURN credential leak guard
 * (`scripts/check-turn-credentials.mjs`).
 *
 * The guard is a plain-Node script invoked by CI in its own job
 * (`.github/workflows/ci.yml → turn-credentials-guard`). These tests
 * exercise it the same way CI does — by spawning `node` against
 * synthetic fixture files in a temporary working tree — so the
 * contract locked in here is the same one that gates a PR merge.
 *
 * Contract summary (from issue #1571):
 *   - inline `turn:`/`turns:` URL credentials (query-param form)
 *     anywhere in source MUST fail
 *   - non-empty committed values for `NEXT_PUBLIC_TURN_URL`/`USER`/`PASS`
 *     in `.env*` files MUST fail (other than the literal public
 *     fallback `openrelayproject`)
 *   - hardcoded `NEXT_PUBLIC_TURN_*` string-literal assignments outside
 *     of `process.env.*` lookups MUST fail
 *   - `process.env.NEXT_PUBLIC_TURN_*` reference lookups MUST pass
 *   - the actual repo state (current #1571 state) MUST pass — this is
 *     the regression check that the canonical fallback form continues
 *     to satisfy the guard
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-turn-credentials.mjs");

// Public OpenRelay fallback credential — the only non-empty value the
// guard permits for `NEXT_PUBLIC_TURN_PASS` in `.env` files because the
// same value is intentionally shipped in
// `PUBLIC_FALLBACK_TURN_SERVERS` (src/lib/ice-config.ts).
const PUBLIC_FALLBACK_CRED = "openrelayproject";

interface GuardResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the guard against the current repo, capturing stdout/stderr. */
function runGuard(): GuardResult {
  const res = cp.spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function expectFail(result: GuardResult, messageFragment?: string): void {
  expect(result.code).toBe(1);
  if (messageFragment !== undefined) {
    const combined = result.stdout + result.stderr;
    expect(combined).toContain(messageFragment);
  }
}

function expectPass(result: GuardResult): void {
  expect(result.code).toBe(0);
}

/**
 * Build a temporary working tree by mirroring the real repo into a
 * temp dir. The guard walks `src/`, `scripts/`, `tests/`, `.github/`,
 * `src-tauri/`, plus top-level `.env*` files; we mirror only those
 * directories so each test starts from the canonical repo state.
 *
 * The temp tree is built via `copyFileSync` (not hardlinks) so a test
 * crash cannot mutate the real repo. The guard is read-only so this is
 * defensive — but cheap enough that the safety is worth it.
 */
function buildTempTree(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "turn-cred-guard-"));
  for (const dir of ["src", "scripts", "tests", ".github", "src-tauri"]) {
    const src = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(tmp, dir);
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const subSrc = path.join(src, entry.name);
        const subDst = path.join(dst, entry.name);
        fs.mkdirSync(subDst, { recursive: true });
        for (const subEntry of fs.readdirSync(subSrc, {
          withFileTypes: true,
        })) {
          if (subEntry.isFile()) {
            fs.copyFileSync(
              path.join(subSrc, subEntry.name),
              path.join(subDst, subEntry.name),
            );
          }
        }
      } else if (entry.isFile()) {
        fs.copyFileSync(path.join(src, entry.name), path.join(dst, entry.name));
      }
    }
  }
  // Mirror top-level .env* files.
  for (const base of fs.readdirSync(REPO_ROOT)) {
    if (!base.startsWith(".env")) continue;
    const src = path.join(REPO_ROOT, base);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(tmp, base));
  }
  return tmp;
}

/** Write a file into the temp tree, creating parent dirs as needed. */
function writeInTree(tree: string, rel: string, contents: string): void {
  const full = path.join(tree, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

/** Run the guard against a synthetic temp tree. The script accepts an
 * alternate REPO_ROOT as its first CLI argument; we pass the temp
 * tree's path so the guard walks the synthetic files instead of the
 * real repo. The synthetic fixture paths deliberately sit OUTSIDE the
 * production allowlists so the inline-URL / hardcoded-var detection
 * paths are exercised without needing CLI escape hatches. */
function runGuardAgainstTree(tree: string): GuardResult {
  const res = cp.spawnSync(process.execPath, [SCRIPT, tree], {
    encoding: "utf8",
    env: { ...process.env },
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

describe("TURN credentials guard (issue #1571)", () => {
  // -------------------------------------------------------------------
  // Repo-state smoke check — runs the guard against the live working
  // tree the same way CI does. A regression against the canonical
  // TURN source (PUBLIC_FALLBACK_TURN_SERVERS) trips this test.
  // -------------------------------------------------------------------
  describe("against the actual repo", () => {
    test("the current repo state passes (canonical #1571 fix)", () => {
      const result = runGuard();
      if (result.code !== 0) {
        // Surface the full guard output so a contributor reading the
        // failure can fix the leak without re-running with extra
        // logging.
        throw new Error(
          `Guard reported violations against the current repo:\n` +
            `STDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`,
        );
      }
      expectPass(result);
    });
  });

  // -------------------------------------------------------------------
  // Contract A: inline turn:/turns: URL credentials.
  //
  // Synthetic fixtures are written to `src/lib/__tests__/_turn-cred-
  // fixture-*.ts` — paths that are NOT in the production allowlist so
  // the detection logic runs against them under the normal
  // `node scripts/check-turn-credentials.mjs <path>` invocation (no
  // allowlist-bypass CLI flag needed). Overwriting
  // `src/lib/ice-config.ts` directly is intentionally avoided so the
  // production allowlist stays the single source of truth.
  // -------------------------------------------------------------------
  describe("contract A: inline turn:/turns: URL credentials", () => {
    test("a leaked turn: URL with username= and credential= fails the guard", () => {
      const tree = buildTempTree();
      try {
        writeInTree(
          tree,
          "src/lib/__tests__/_turn-cred-fixture-leak.ts",
          [
            "// Synthetic fixture for #1571 — should fail the guard.",
            "export const TURN: ICEServerConfig = {",
            "  urls: 'turn:coturn.example.com:3478?username=alice&credential=myRealSecretPassword',",
            "  credentialType: 'password',",
            "};",
            "",
          ].join("\n"),
        );
        expectFail(runGuardAgainstTree(tree), "inline credential on TURN URL");
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });

    test("a turns: URL with credential= (no username=) fails the guard", () => {
      const tree = buildTempTree();
      try {
        writeInTree(
          tree,
          "src/lib/__tests__/_turn-cred-fixture-leak.ts",
          [
            "// Synthetic fixture for #1571 — should fail the guard.",
            "export const TURN = {",
            "  urls: 'turns:turn.example.com:443?credential=myRealSecretPassword',",
            "};",
            "",
          ].join("\n"),
        );
        expectFail(runGuardAgainstTree(tree), "inline credential on TURN URL");
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });

    test("a turn: URL without inline credentials passes", () => {
      const tree = buildTempTree();
      try {
        writeInTree(
          tree,
          "src/lib/__tests__/_turn-cred-fixture-clean.ts",
          [
            "// Synthetic fixture for #1571 — should pass the guard.",
            "export const TURN = {",
            "  urls: 'turn:turn.example.com:3478',",
            "  username: 'openrelayproject',",
            "  credential: 'openrelayproject',",
            "  credentialType: 'password',",
            "};",
            "",
          ].join("\n"),
        );
        expectPass(runGuardAgainstTree(tree));
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------
  // Contract B: committed .env values for NEXT_PUBLIC_TURN_* keys.
  // -------------------------------------------------------------------
  describe("contract B: committed NEXT_PUBLIC_TURN_* env values", () => {
    test("a .env.local with a real NEXT_PUBLIC_TURN_PASS fails the guard", () => {
      const tree = buildTempTree();
      try {
        writeInTree(
          tree,
          ".env.local",
          "NEXT_PUBLIC_TURN_PASS=myRealSecretPassword\n",
        );
        expectFail(
          runGuardAgainstTree(tree),
          "committed non-empty value for NEXT_PUBLIC_TURN_PASS",
        );
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });

    test("an empty NEXT_PUBLIC_TURN_PASS value is allowed", () => {
      const tree = buildTempTree();
      try {
        writeInTree(tree, ".env.local", "NEXT_PUBLIC_TURN_PASS=\n");
        expectPass(runGuardAgainstTree(tree));
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });

    test("the literal openrelayproject value is allowed (public fallback)", () => {
      const tree = buildTempTree();
      try {
        writeInTree(
          tree,
          ".env.local",
          `NEXT_PUBLIC_TURN_PASS=${PUBLIC_FALLBACK_CRED}\n`,
        );
        expectPass(runGuardAgainstTree(tree));
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });

    test("a NEXT_PUBLIC_TURN_URL with a real host fails the guard", () => {
      const tree = buildTempTree();
      try {
        writeInTree(
          tree,
          ".env",
          "NEXT_PUBLIC_TURN_URL=turn:turn.example.com:3478\n" +
            "NEXT_PUBLIC_TURN_USER=alice\n" +
            "NEXT_PUBLIC_TURN_PASS=alice123\n",
        );
        expectFail(
          runGuardAgainstTree(tree),
          "committed non-empty value for NEXT_PUBLIC_TURN_PASS",
        );
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });

    test("commented-out placeholders in .env files are allowed", () => {
      const tree = buildTempTree();
      try {
        writeInTree(
          tree,
          ".env.example",
          [
            "# NEXT_PUBLIC_TURN_URL=turn:turn.your-domain.com:3478",
            "# NEXT_PUBLIC_TURN_USER=your-username",
            "# NEXT_PUBLIC_TURN_PASS=your-credential",
            "",
          ].join("\n"),
        );
        expectPass(runGuardAgainstTree(tree));
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------
  // Contract C: hardcoded NEXT_PUBLIC_TURN_* string assignments outside
  // process.env lookups.
  // -------------------------------------------------------------------
  describe("contract C: hardcoded NEXT_PUBLIC_TURN_* assignments", () => {
    test("a hardcoded NEXT_PUBLIC_TURN_PASS string in next.config.ts fails the guard", () => {
      const tree = buildTempTree();
      try {
        writeInTree(
          tree,
          "next.config.ts",
          [
            "// Synthetic fixture for #1571 — should fail the guard.",
            "const nextConfig = {",
            "  env: {",
            "    NEXT_PUBLIC_TURN_PASS: 'myRealSecretPassword',",
            "  },",
            "};",
            "export default nextConfig;",
            "",
          ].join("\n"),
        );
        expectFail(
          runGuardAgainstTree(tree),
          "hardcoded NEXT_PUBLIC_TURN_* assignment",
        );
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });

    test("a process.env.NEXT_PUBLIC_TURN_PASS reference is allowed", () => {
      const tree = buildTempTree();
      try {
        writeInTree(
          tree,
          "next.config.ts",
          [
            "// Synthetic fixture for #1571 — should pass the guard.",
            "const nextConfig = {",
            "  env: {",
            "    NEXT_PUBLIC_TURN_PASS: process.env.NEXT_PUBLIC_TURN_PASS,",
            "  },",
            "};",
            "export default nextConfig;",
            "",
          ].join("\n"),
        );
        expectPass(runGuardAgainstTree(tree));
      } finally {
        fs.rmSync(tree, { recursive: true, force: true });
      }
    });
  });
});
