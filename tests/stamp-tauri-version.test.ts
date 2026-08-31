/**
 * Behavioural tests for the issue #1588 Tauri release-version stamp.
 *
 * The stamp + restore scripts (`scripts/stamp-tauri-version.sh` and
 * `scripts/restore-tauri-version.sh`) are the heart of the fix: they
 * rewrite `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` so the
 * bundled app's version matches the release tag (and revert after
 * `tauri build`). These tests exercise the scripts end-to-end against
 * fixture copies of the repo's actual config files, the same way the
 * GitHub Actions composite actions invoke them.
 *
 * Why bash + temp dirs rather than parsing JSON/TOML in-process:
 *   - catches sed/jq quoting bugs that unit tests would miss
 *   - mirrors how CI invokes the scripts (`bash scripts/...`)
 *   - the scripts already print ::error:: annotations on failure, so
 *     a regression shows up clearly in the Jest output
 *
 * Test files live under `tests/` per the repo's Jest config
 * (`jest.config.js` `roots`) and follow the same spawn-and-inspect
 * convention as `tests/updater-config-guard.test.ts` (#1430) and
 * `tests/macos-notarization-wiring.test.ts` (#1399).
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const STAMP_SCRIPT = path.join(REPO_ROOT, "scripts", "stamp-tauri-version.sh");
const RESTORE_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "restore-tauri-version.sh",
);
const REAL_CONF = path.join(REPO_ROOT, "src-tauri", "tauri.conf.json");
const REAL_CARGO = path.join(REPO_ROOT, "src-tauri", "Cargo.toml");

const ACTIONS_DIR = path.join(REPO_ROOT, ".github", "actions");
const STAMP_ACTION = path.join(
  ACTIONS_DIR,
  "stamp-tauri-version",
  "action.yml",
);
const RESTORE_ACTION = path.join(
  ACTIONS_DIR,
  "restore-tauri-version",
  "action.yml",
);
const RELEASE_YML = path.join(REPO_ROOT, ".github", "workflows", "release.yml");

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
): CmdResult {
  const res = cp.spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readText(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function makeFixtureDir(): { dir: string; conf: string; cargo: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-tauri-test-"));
  const conf = path.join(dir, "tauri.conf.json");
  const cargo = path.join(dir, "Cargo.toml");
  fs.copyFileSync(REAL_CONF, conf);
  fs.copyFileSync(REAL_CARGO, cargo);
  return { dir, conf, cargo };
}

describe("stamp + restore (issue #1588)", () => {
  test("stamp rewrites both files to the stripped tag and restores them", () => {
    const { dir, conf, cargo } = makeFixtureDir();
    const stateFile = path.join(dir, "state.env");

    const stamp = run("bash", [STAMP_SCRIPT], {
      CONF_PATH: conf,
      CARGO_PATH: cargo,
      STAMP_STATE: stateFile,
      RELEASE_VERSION_RAW: "v1.8.0",
    });
    expect(stamp.code).toBe(0);
    if (stamp.code !== 0) {
      // Surface the error inline so a failure isn't just an opaque exit code.
      console.error("stamp stdout:", stamp.stdout);
      console.error("stamp stderr:", stamp.stderr);
    }

    // Stamp should have rewritten both files to 1.8.0
    expect(readJson<{ version: string }>(conf).version).toBe("1.8.0");
    expect(readText(cargo)).toMatch(/^version = "1\.8\.0"$/m);

    // State file should record the snapshot
    expect(fs.existsSync(stateFile)).toBe(true);
    const stateLines = readText(stateFile);
    expect(stateLines).toContain("STAMPED=true");
    expect(stateLines).toContain("ORIG_CONF_VERSION=1.0.0");
    expect(stateLines).toContain("ORIG_CARGO_VERSION=1.0.0");
    expect(stateLines).toContain("NEW_VERSION=1.8.0");

    // Restore should revert both files to 1.0.0
    const restore = run("bash", [RESTORE_SCRIPT], {
      CONF_PATH: conf,
      CARGO_PATH: cargo,
      STAMP_STATE: stateFile,
    });
    expect(restore.code).toBe(0);
    if (restore.code !== 0) {
      console.error("restore stdout:", restore.stdout);
      console.error("restore stderr:", restore.stderr);
    }
    expect(readJson<{ version: string }>(conf).version).toBe("1.0.0");
    expect(readText(cargo)).toMatch(/^version = "1\.0\.0"$/m);
    expect(fs.existsSync(stateFile)).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("no-op when no release tag is detected (workflow_dispatch)", () => {
    const { dir, conf, cargo } = makeFixtureDir();
    const stateFile = path.join(dir, "state.env");

    // Empty GITHUB_REF + no RELEASE_VERSION_RAW -> no tag -> no-op.
    const stamp = run("bash", [STAMP_SCRIPT], {
      CONF_PATH: conf,
      CARGO_PATH: cargo,
      STAMP_STATE: stateFile,
      GITHUB_REF: "refs/heads/main",
    });
    expect(stamp.code).toBe(0);
    expect(readJson<{ version: string }>(conf).version).toBe("1.0.0");
    expect(readText(cargo)).toMatch(/^version = "1\.0\.0"$/m);
    expect(readText(stateFile)).toContain("STAMPED=false");

    // Restore should also be a clean no-op.
    const restore = run("bash", [RESTORE_SCRIPT], {
      CONF_PATH: conf,
      CARGO_PATH: cargo,
      STAMP_STATE: stateFile,
    });
    expect(restore.code).toBe(0);
    expect(readJson<{ version: string }>(conf).version).toBe("1.0.0");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("falls back to GITHUB_REF when RELEASE_VERSION_RAW is unset (tag-push path)", () => {
    const { dir, conf, cargo } = makeFixtureDir();
    const stateFile = path.join(dir, "state.env");

    const stamp = run("bash", [STAMP_SCRIPT], {
      CONF_PATH: conf,
      CARGO_PATH: cargo,
      STAMP_STATE: stateFile,
      GITHUB_REF: "refs/tags/v2.3.4",
    });
    expect(stamp.code).toBe(0);
    expect(readJson<{ version: string }>(conf).version).toBe("2.3.4");
    expect(readText(cargo)).toMatch(/^version = "2\.3\.4"$/m);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("rejects invalid semver with ::error:: annotation and leaves files untouched", () => {
    const { dir, conf, cargo } = makeFixtureDir();
    const stateFile = path.join(dir, "state.env");

    const stamp = run("bash", [STAMP_SCRIPT], {
      CONF_PATH: conf,
      CARGO_PATH: cargo,
      STAMP_STATE: stateFile,
      RELEASE_VERSION_RAW: "not-a-version",
    });
    expect(stamp.code).toBe(1);
    expect(stamp.stderr).toContain("::error::");
    expect(stamp.stderr).toContain("not a valid semver");
    // Files must NOT have been rewritten.
    expect(readJson<{ version: string }>(conf).version).toBe("1.0.0");
    expect(readText(cargo)).toMatch(/^version = "1\.0\.0"$/m);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("accepts prerelease semver (v1.8.0-rc.1 -> 1.8.0-rc.1)", () => {
    const { dir, conf, cargo } = makeFixtureDir();
    const stateFile = path.join(dir, "state.env");

    const stamp = run("bash", [STAMP_SCRIPT], {
      CONF_PATH: conf,
      CARGO_PATH: cargo,
      STAMP_STATE: stateFile,
      RELEASE_VERSION_RAW: "v1.8.0-rc.1",
    });
    expect(stamp.code).toBe(0);
    expect(readJson<{ version: string }>(conf).version).toBe("1.8.0-rc.1");
    expect(readText(cargo)).toMatch(/^version = "1\.8\.0-rc\.1"$/m);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("restore is a no-op when the current version is no longer the stamped value", () => {
    const { dir, conf, cargo } = makeFixtureDir();
    const stateFile = path.join(dir, "state.env");

    // Stamp to 1.8.0, then mutate the config file to a third-party value
    // (simulating a downstream step editing the file), then restore.
    run("bash", [STAMP_SCRIPT], {
      CONF_PATH: conf,
      CARGO_PATH: cargo,
      STAMP_STATE: stateFile,
      RELEASE_VERSION_RAW: "v1.8.0",
    });
    // Simulate a downstream edit that already changed the value.
    const tmp = path.join(dir, "tauri.conf.json.tmp");
    fs.writeFileSync(
      tmp,
      JSON.stringify({ ...readJson(conf), version: "9.9.9" }, null, 2),
    );
    fs.renameSync(tmp, conf);

    const restore = run("bash", [RESTORE_SCRIPT], {
      CONF_PATH: conf,
      CARGO_PATH: cargo,
      STAMP_STATE: stateFile,
    });
    expect(restore.code).toBe(0);
    // Restore should NOT have clobbered the third-party value.
    expect(readJson<{ version: string }>(conf).version).toBe("9.9.9");

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("composite actions + workflow wiring (issue #1588)", () => {
  test(".github/actions/stamp-tauri-version/action.yml exists and is a composite", () => {
    expect(fs.existsSync(STAMP_ACTION)).toBe(true);
    const yml = readText(STAMP_ACTION);
    expect(yml).toContain("runs:");
    expect(yml).toContain("using: composite");
    expect(yml).toContain("outputs:");
    // Outputs cover what the workflow's `if:` conditions need.
    expect(yml).toMatch(/^\s{2}stamped:/m);
    expect(yml).toMatch(/^\s{2}version:/m);
    expect(yml).toMatch(/^\s{2}orig-conf-version:/m);
    expect(yml).toMatch(/^\s{2}orig-cargo-version:/m);
  });

  test(".github/actions/restore-tauri-version/action.yml exists and is a composite", () => {
    expect(fs.existsSync(RESTORE_ACTION)).toBe(true);
    const yml = readText(RESTORE_ACTION);
    expect(yml).toContain("runs:");
    expect(yml).toContain("using: composite");
    // Should accept the same state-file input so the two actions pair up.
    expect(yml).toContain("state-file");
  });

  test("release.yml calls stamp + restore around each of the three tauri build steps", () => {
    const releaseYml = readText(RELEASE_YML);
    // Each platform job must include both steps. Use the `\n      run: tauri build`
    // substring so we match the actual command line, not the explanatory
    // comment ("BEFORE tauri build so the installer...").
    const tauriBuildSubstr = "\n        run: tauri build";
    for (const job of ["build-windows:", "build-macos:", "build-linux:"]) {
      const start = releaseYml.indexOf(job);
      const nextBuild = releaseYml.indexOf("\n  build-", start + job.length);
      const end = nextBuild === -1 ? releaseYml.length : nextBuild;
      const section = releaseYml.slice(start, end);
      expect(section).toContain("uses: ./.github/actions/stamp-tauri-version");
      expect(section).toContain(
        "uses: ./.github/actions/restore-tauri-version",
      );
      // Stamp must precede the actual tauri build; restore must follow it.
      const stampIdx = section.indexOf("Stamp tauri release version");
      const tauriIdx = section.indexOf(tauriBuildSubstr);
      const restoreIdx = section.indexOf("Restore tauri release version");
      expect(stampIdx).toBeGreaterThan(-1);
      expect(tauriIdx).toBeGreaterThan(stampIdx);
      expect(restoreIdx).toBeGreaterThan(tauriIdx);
    }
  });

  test("release.yml restore steps use always() so they run on tauri build failure", () => {
    const releaseYml = readText(RELEASE_YML);
    // Each restore step's `if:` must include `always()` so it runs even
    // when tauri build fails — the snapshot must be reverted even on
    // a broken build so the next matrix leg / re-run sees clean files.
    // Find every "Restore tauri release version" step and grab the next
    // 4 lines of YAML below it (enough to capture `if:` + `uses:`).
    const restoreBlocks: string[] = [];
    const re =
      /- name: Restore tauri release version[^\n]*\n((?:[ \t]+[^\n]*\n){1,6})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(releaseYml)) !== null) {
      restoreBlocks.push(m[0]);
    }
    expect(restoreBlocks.length).toBe(3); // one per platform job
    for (const block of restoreBlocks) {
      expect(block).toMatch(/if: always\(\)/);
      expect(block).toMatch(/steps\.stamp\.outputs\.stamped == 'true'/);
    }
  });
});
