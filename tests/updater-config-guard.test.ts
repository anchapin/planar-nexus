/**
 * Integration tests for the issue #1430 Tauri updater config guard
 * (`scripts/check-tauri-updater-config.mjs`).
 *
 * The guard is a plain-Node script invoked by CI in its own job
 * (`.github/workflows/ci.yml → tauri-updater-config`). These tests
 * exercise it the same way CI does — by spawning `node` against a
 * fixture config — so the contract locked in here is the same one
 * that gates a PR merge.
 *
 * Contract summary (from issue #1430):
 *   - empty `pubkey` while `active: true` MUST fail (the MITM default)
 *   - non-minisign `pubkey` MUST fail (stops placeholders like "TODO")
 *   - non-HTTPS endpoint MUST fail (TLS pinning)
 *   - non-`.json` endpoint MUST fail (manifest shape)
 *   - empty `endpoints` array MUST fail
 *   - absent updater block MUST pass (option B — disabled)
 *   - `active: false` MUST pass (explicitly disabled)
 *   - `bundle.createUpdaterArtifacts: true` without an active updater MUST fail
 *   - the canonical active updater (real minisign pubkey + HTTPS .json endpoint)
 *     MUST pass — this is the current repo state, established by #1403.
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "check-tauri-updater-config.mjs",
);
const REAL_CONF = path.join(REPO_ROOT, "src-tauri", "tauri.conf.json");

const MINISIGN_PREFIX = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6";
const VALID_PUBKEY =
  MINISIGN_PREFIX +
  "IDEyMzQ1Njc4OTAxMjM0NTYKUldUa0EwR1NTVkdQSVpsWW1jYXJlSlZLSG0xYmc4OXAvbWtDdVNLRVltekR4NUtvN01LSFp0VnYK";
const VALID_ENDPOINT =
  "https://github.com/anchapin/planar-nexus/releases/latest/download/latest.json";

interface GuardResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGuard(config: unknown): GuardResult {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tauri-conf-"));
  const confPath = path.join(tmp, "tauri.conf.json");
  fs.writeFileSync(confPath, JSON.stringify(config));
  try {
    const res = cp.spawnSync(process.execPath, [SCRIPT, confPath], {
      encoding: "utf8",
    });
    return {
      code: res.status ?? -1,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function expectFail(result: GuardResult, messageFragment?: string) {
  expect(result.code).toBe(1);
  if (messageFragment !== undefined) {
    const combined = result.stdout + result.stderr;
    expect(combined).toContain(messageFragment);
  }
}

function expectPass(result: GuardResult) {
  expect(result.code).toBe(0);
}

describe("Tauri updater config guard (issue #1430)", () => {
  test("the actual repo config passes (current #1403 state)", () => {
    // Smoke check that the canonical repo state still satisfies the guard.
    // If this fails, the updater config has drifted from the documented
    // #1403 contract and a release will be gated.
    const res = cp.spawnSync(process.execPath, [SCRIPT, REAL_CONF], {
      encoding: "utf8",
    });
    expectPass({
      code: res.status ?? -1,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    });
  });

  test("empty pubkey while active=true fails (the #1430 MITM default)", () => {
    expectFail(
      runGuard({
        plugins: {
          updater: { active: true, pubkey: "", endpoints: [VALID_ENDPOINT] },
        },
      }),
      "pubkey is empty",
    );
  });

  test("placeholder pubkey that is not minisign-format fails", () => {
    expectFail(
      runGuard({
        plugins: {
          updater: {
            active: true,
            pubkey: "TODO",
            endpoints: [VALID_ENDPOINT],
          },
        },
      }),
      "minisign public-key format",
    );
  });

  test("HTTP endpoint fails (must be HTTPS-pinned)", () => {
    expectFail(
      runGuard({
        plugins: {
          updater: {
            active: true,
            pubkey: VALID_PUBKEY,
            endpoints: ["http://example.com/latest.json"],
          },
        },
      }),
      "HTTPS",
    );
  });

  test("endpoint not ending in .json fails (manifest shape)", () => {
    expectFail(
      runGuard({
        plugins: {
          updater: {
            active: true,
            pubkey: VALID_PUBKEY,
            endpoints: ["https://example.com/feed"],
          },
        },
      }),
      ".json",
    );
  });

  test("empty endpoints array fails", () => {
    expectFail(
      runGuard({
        plugins: {
          updater: { active: true, pubkey: VALID_PUBKEY, endpoints: [] },
        },
      }),
      "endpoints is empty",
    );
  });

  test("active=true with only the active field fails (missing pubkey + endpoints)", () => {
    expectFail(
      runGuard({
        plugins: { updater: { active: true } },
      }),
    );
  });

  test("updater block entirely absent passes (#1430 option B)", () => {
    expectPass(runGuard({ plugins: {} }));
  });

  test("explicitly disabled updater passes (active=false)", () => {
    expectPass(
      runGuard({
        plugins: {
          updater: { active: false, pubkey: "", endpoints: [] },
        },
      }),
    );
  });

  test("canonical active updater with real minisign pubkey + HTTPS .json endpoint passes", () => {
    expectPass(
      runGuard({
        plugins: {
          updater: {
            active: true,
            pubkey: VALID_PUBKEY,
            endpoints: [VALID_ENDPOINT],
          },
        },
      }),
    );
  });

  test("bundle.createUpdaterArtifacts=true with no updater block fails (orphan .sig files)", () => {
    expectFail(
      runGuard({
        bundle: { createUpdaterArtifacts: true },
        plugins: {},
      }),
      "createUpdaterArtifacts",
    );
  });

  test("bundle.createUpdaterArtifacts=true with empty pubkey fails", () => {
    expectFail(
      runGuard({
        bundle: { createUpdaterArtifacts: true },
        plugins: {
          updater: { active: true, pubkey: "", endpoints: [VALID_ENDPOINT] },
        },
      }),
    );
  });

  test("non-boolean active value fails closed (rejects shape drift)", () => {
    expectFail(
      runGuard({
        plugins: {
          updater: {
            active: "yes",
            pubkey: VALID_PUBKEY,
            endpoints: [VALID_ENDPOINT],
          },
        },
      }),
      "must be a boolean",
    );
  });

  test("non-existent config path fails with a clear error", () => {
    const res = cp.spawnSync(
      process.execPath,
      [SCRIPT, "/nonexistent/tauri.conf.json"],
      { encoding: "utf8" },
    );
    expectFail(
      {
        code: res.status ?? -1,
        stdout: res.stdout ?? "",
        stderr: res.stderr ?? "",
      },
      "config not found",
    );
  });

  test("malformed JSON fails with a parse error", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tauri-conf-"));
    const confPath = path.join(tmp, "tauri.conf.json");
    fs.writeFileSync(confPath, "{not valid json");
    try {
      const res = cp.spawnSync(process.execPath, [SCRIPT, confPath], {
        encoding: "utf8",
      });
      expectFail(
        {
          code: res.status ?? -1,
          stdout: res.stdout ?? "",
          stderr: res.stderr ?? "",
        },
        "could not parse JSON",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
