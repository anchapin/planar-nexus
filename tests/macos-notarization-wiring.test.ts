/**
 * Smoke tests for the macOS code-signing + notarization wiring
 * (issue #1399).
 *
 * Asserts the contracts documented in the issue acceptance criteria that
 * can be checked without spinning up macOS or a Tauri build:
 *
 *   1. `src-tauri/tauri.conf.json` `bundle.macOS.hardenedRuntime` is
 *      `true` (a hard requirement for `notarytool` since 2023 — without
 *      it, Apple refuses the submission even if every secret is set).
 *   2. `src-tauri/tauri.conf.json` `bundle.macOS.signingIdentity` is
 *      not pinned to ad-hoc (`"-"`); it must defer to the
 *      `APPLE_SIGNING_IDENTITY` env var so CI can inject the real
 *      identity at build time. A literal `"-"` here would force the
 *      hardened-runtime build to abort with `IdentityNotFound`.
 *   3. `.github/workflows/release.yml::build-macos` runs a Tauri build
 *      with `APPLE_SIGNING_IDENTITY` injected.
 *   4. The same job calls `xcrun notarytool submit` and
 *      `xcrun stapler staple` for both the `.app` and `.dmg` artifacts.
 *   5. The notarize/staple steps skip gracefully when the Apple-ID
 *      secrets are missing so contributors without org access still get
 *      an unsigned-but-uploaded DMG.
 *   6. `docs/RELEASE_RUNBOOK.md` §5 documents the `APPLE_ID`,
 *      `APPLE_TEAM_ID`, `APPLE_PASSWORD` secrets so the on-call release
 *      engineer can find them in one place.
 *
 * The tests run in plain Node (no Tauri runtime required) so they fail
 * fast in CI — same convention as `tests/updater-wiring.test.ts`.
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const TAURI_CONF = path.join(REPO_ROOT, "src-tauri", "tauri.conf.json");
const RELEASE_YML = path.join(REPO_ROOT, ".github", "workflows", "release.yml");
const RUNBOOK = path.join(REPO_ROOT, "docs", "RELEASE_RUNBOOK.md");

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function readText(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("macOS notarization wiring (issue #1399)", () => {
  const conf = readJson(TAURI_CONF) as {
    bundle?: {
      macOS?: {
        hardenedRuntime?: boolean;
        signingIdentity?: string | null;
      };
    };
  };
  const mac = conf.bundle?.macOS ?? {};
  const releaseYml = readText(RELEASE_YML);
  const runbook = readText(RUNBOOK);

  // ---------------------------------------------------------------------
  // 1+2 — tauri.conf.json bundle.macOS shape
  // ---------------------------------------------------------------------

  test("bundle.macOS.hardenedRuntime is true (required for notarytool)", () => {
    // `false` is the previous (regressed) state that issue #1399 is
    // closing. Anything other than `true` — including a missing key —
    // breaks notarization even with valid Apple credentials.
    expect(mac.hardenedRuntime).toBe(true);
  });

  test("bundle.macOS.signingIdentity is not pinned to ad-hoc ('-')", () => {
    // A literal '-' here would force `codesign` to sign ad-hoc even
    // when APPLE_SIGNING_IDENTITY is set, and Apple's hardened-runtime
    // check rejects ad-hoc identities. Leave it null (or unset) so the
    // env var is authoritative.
    expect(
      mac.signingIdentity === undefined || mac.signingIdentity === null,
    ).toBe(true);
  });

  // ---------------------------------------------------------------------
  // 3+4+5 — .github/workflows/release.yml shape
  // ---------------------------------------------------------------------

  test("release.yml build-macos step injects APPLE_SIGNING_IDENTITY", () => {
    // Sanity-check that the env is plumbed through to the tauri build
    // step. Without it, hardened-runtime=true will trip the lack-of-
    // signing-identity abort regardless of the global env.
    const buildJob = releaseYml.slice(
      releaseYml.indexOf("build-macos:"),
      releaseYml.indexOf("build-linux:"),
    );
    expect(buildJob).toContain("APPLE_SIGNING_IDENTITY");
    expect(buildJob).toContain("secrets.APPLE_SIGNING_IDENTITY");
    expect(buildJob).toContain("tauri build --target universal-apple-darwin");
  });

  test("release.yml build-macos submits the .app to notarytool and staples it", () => {
    const buildJob = releaseYml.slice(
      releaseYml.indexOf("build-macos:"),
      releaseYml.indexOf("build-linux:"),
    );

    // notrytool submit + wait for the .app. The shell command uses YAML
    // block-scalar continuations (`\\\n`) so the regex tolerates
    // either one-line or `\`-continued invocations.
    expect(buildJob).toMatch(
      /notarytool\s+submit[\s\S]*?--apple-id\s+"\$APPLE_ID"[\s\S]*?--password\s+"\$APPLE_PASSWORD"[\s\S]*?--team-id\s+"\$APPLE_TEAM_ID"[\s\S]*?--wait/m,
    );
    // stapler staple step keyed off the same locate_app outputs
    expect(buildJob).toContain("xcrun stapler staple");
    expect(buildJob).toContain("steps.locate_app.outputs.app-path");
  });

  test("release.yml build-macos submits the .dmg to notarytool and staples it", () => {
    // The DMG also needs to be notarized so a fresh user who double-
    // clicks the .dmg (the recommended install path on macOS) doesn't
    // trigger Gatekeeper.
    const buildJob = releaseYml.slice(
      releaseYml.indexOf("build-macos:"),
      releaseYml.indexOf("build-linux:"),
    );
    expect(buildJob).toContain("steps.locate_dmg.outputs.dmg-path");
    expect(buildJob).toMatch(
      /notarytool\s+submit[^\n]*steps\.locate_dmg\.outputs\.dmg-path/m,
    );
    expect(buildJob).toMatch(
      /stapler\s+staple[^\n]*steps\.locate_dmg\.outputs\.dmg-path/m,
    );
  });

  test("release.yml notarization steps skip gracefully when Apple secrets are missing", () => {
    // The release pipeline must NOT fail when the org hasn't yet set
    // APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID. A clear, deliberate
    // conditional skip is required so a fresh-tags-on-fork workflow
    // run still ships a DMG (just un-notarized).
    const buildJob = releaseYml.slice(
      releaseYml.indexOf("build-macos:"),
      releaseYml.indexOf("build-linux:"),
    );
    expect(buildJob).toContain("secrets.APPLE_ID");
    expect(buildJob).toContain("secrets.APPLE_PASSWORD");
    expect(buildJob).toContain("secrets.APPLE_TEAM_ID");
    // The notice/warning at end of the job documents the skip so the
    // on-call release engineer can tell from the GH Actions UI that the
    // DMG is intentionally unsigned.
    expect(buildJob).toMatch(/::warning::macOS notarization skipped/);
  });

  // ---------------------------------------------------------------------
  // 6 — docs/RELEASE_RUNBOOK.md
  // ---------------------------------------------------------------------

  test("RELEASE_RUNBOOK.md §5 documents the Apple notarization secrets", () => {
    // The on-call release engineer needs to be able to find the four
    // required secrets (§2 inventory) and the workflow behavior (§5
    // flow) in one place, without grepping through the workflow yaml.
    const section5 = runbook.slice(
      runbook.indexOf("## 5. macOS Code-Signing"),
      runbook.indexOf("## 6. Linux Packaging"),
    );
    expect(section5).toContain("APPLE_ID");
    expect(section5).toContain("APPLE_TEAM_ID");
    expect(section5).toContain("APPLE_PASSWORD");
    // The §5 flow must mention the actual concrete xcrun invocations so
    // a future operator grepping the runbook sees the exact commands.
    expect(section5).toContain("xcrun notarytool submit");
    expect(section5).toContain("xcrun stapler staple");
    // Hardened runtime is mentioned by name — without it the runbook is
    // incomplete guidance for whoever re-validates the next rotation.
    expect(section5).toMatch(/hardened\s*runtime/i);
  });

  test("RELEASE_RUNBOOK.md §2 secrets inventory lists the three Apple secrets", () => {
    // The single-row inventory must keep §2 and §5 in sync — if §5
    // adds a secret, the table has to mention it too.
    expect(runbook).toMatch(/\|\s*`APPLE_ID`\s*\|/);
    expect(runbook).toMatch(/\|\s*`APPLE_PASSWORD`\s*\|/);
    expect(runbook).toMatch(/\|\s*`APPLE_TEAM_ID`\s*\|/);
    expect(runbook).toMatch(/\|\s*`APPLE_SIGNING_IDENTITY`\s*\|/);
  });
});
