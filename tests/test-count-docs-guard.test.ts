/**
 * Integration tests for the test-count docs guard and ratchet
 * (`scripts/check-test-count-docs.mjs`, `scripts/ratchet-test-count.mjs`),
 * issues #1910 and #2342.
 *
 * Issue #2342: `docs/onboarding.md` carries the same anchored block as
 * `docs/TEST_VIDEO_FIXTURES.md`, in a markdown format, but neither script
 * read it, so its suite count drifted with no CI failure. These tests pin
 * that both scripts now cover both docs and both formats.
 *
 * Both scripts take `--live <counts.json>` in place of running Jest, so
 * nothing here recurses into the full suite.
 *
 * @jest-environment node
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const GUARD = path.join(REPO_ROOT, "scripts", "check-test-count-docs.mjs");
const RATCHET = path.join(REPO_ROOT, "scripts", "ratchet-test-count.mjs");

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[]): Result {
  const proc = cp.spawnSync(process.execPath, [script, ...args], {
    encoding: "utf-8",
  });
  return {
    code: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

const LIVE = {
  suites: 594,
  listed: 594,
  total: 12444,
  passed: 12437,
  skipped: 7,
  todo: 0,
  snapshots: 3,
};

function bashDoc(o: {
  suites: number;
  listed: number;
  total: number;
  passed: number;
  skipped: number;
}): string {
  return (
    "# Fixtures\n\n```bash\n# Full test suite\nnpm test\n" +
    "<!-- TEST_COUNT:START -->\n" +
    `# → Test Suites: ${o.suites} passed, ${o.suites} total  (--listTests: ${o.listed} files)\n` +
    `# → Tests: ${o.passed} passed, ${o.skipped} skipped, ${o.total} total\n` +
    "<!-- TEST_COUNT:END -->\n```\n\nTrailing prose.\n"
  );
}

function markdownDoc(o: {
  suites: number;
  total: number;
  passed: number;
  skipped: number;
  snapshots: number;
}): string {
  return (
    "## Current test count\n\nIntro prose.\n\n" +
    "<!-- TEST_COUNT:START -->\n\n" +
    `**Test suites:** ${o.suites}\n` +
    `**Test cases:** ${o.total} (${o.passed} passed + ${o.skipped} skipped)\n` +
    `**Snapshots:** ${o.snapshots}\n` +
    "<!-- TEST_COUNT:END -->\n\n## Next section\n"
  );
}

describe("test-count docs guard and ratchet (#2342)", () => {
  let tmp: string;
  let livePath: string;
  let fixturesDoc: string;
  let onboardingDoc: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-count-docs-"));
    livePath = path.join(tmp, "live.json");
    fixturesDoc = path.join(tmp, "TEST_VIDEO_FIXTURES.md");
    onboardingDoc = path.join(tmp, "onboarding.md");
    fs.writeFileSync(livePath, JSON.stringify(LIVE), "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const guard = (): Result =>
    run(GUARD, [
      "--live",
      livePath,
      "--doc",
      fixturesDoc,
      "--doc",
      onboardingDoc,
    ]);
  const ratchet = (): Result =>
    run(RATCHET, [
      "--live",
      livePath,
      "--doc",
      fixturesDoc,
      "--doc",
      onboardingDoc,
    ]);

  it("passes when both docs, in both formats, match live Jest", () => {
    fs.writeFileSync(fixturesDoc, bashDoc(LIVE));
    fs.writeFileSync(onboardingDoc, markdownDoc(LIVE));
    const res = guard();
    expect(res.stderr).toBe("");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("PASS: ");
    expect(res.stdout.match(/PASS: /g)).toHaveLength(2);
  });

  it("fails and names onboarding.md when only its suite count has drifted", () => {
    // The exact #2342 scenario: fixtures doc correct, onboarding 4 suites behind.
    fs.writeFileSync(fixturesDoc, bashDoc(LIVE));
    fs.writeFileSync(onboardingDoc, markdownDoc({ ...LIVE, suites: 590 }));
    const res = guard();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("onboarding.md is out of sync");
    expect(res.stderr).toContain("Test Suites: doc=590, live=594");
    expect(res.stderr).not.toContain("TEST_VIDEO_FIXTURES.md is out of sync");
  });

  it("fails on a stale snapshot count in the markdown block", () => {
    fs.writeFileSync(fixturesDoc, bashDoc(LIVE));
    fs.writeFileSync(onboardingDoc, markdownDoc({ ...LIVE, snapshots: 2 }));
    const res = guard();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("Snapshots: doc=2, live=3");
  });

  it("fails when onboarding.md loses its anchors", () => {
    fs.writeFileSync(fixturesDoc, bashDoc(LIVE));
    fs.writeFileSync(
      onboardingDoc,
      markdownDoc(LIVE).replace("<!-- TEST_COUNT:START -->", ""),
    );
    const res = guard();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("missing");
    expect(res.stderr).toContain("onboarding.md is out of sync");
  });

  it("still fails on a stale --listTests count in the bash block", () => {
    fs.writeFileSync(fixturesDoc, bashDoc({ ...LIVE, listed: 593 }));
    fs.writeFileSync(onboardingDoc, markdownDoc(LIVE));
    const res = guard();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("--listTests count: doc=593, live=594");
  });

  it("ratchet rewrites both blocks in their own format and leaves the prose alone", () => {
    const staleBash = bashDoc({
      ...LIVE,
      suites: 500,
      listed: 500,
      total: 1,
      passed: 1,
      skipped: 0,
    });
    const staleMd = markdownDoc({ ...LIVE, suites: 581, snapshots: 0 });
    fs.writeFileSync(fixturesDoc, staleBash);
    fs.writeFileSync(onboardingDoc, staleMd);

    const res = ratchet();
    expect(res.code).toBe(0);
    expect(fs.readFileSync(fixturesDoc, "utf-8")).toBe(bashDoc(LIVE));
    expect(fs.readFileSync(onboardingDoc, "utf-8")).toBe(markdownDoc(LIVE));
    expect(guard().code).toBe(0);
  });

  it("ratchet is a byte-for-byte noop when both docs are current", () => {
    fs.writeFileSync(fixturesDoc, bashDoc(LIVE));
    fs.writeFileSync(onboardingDoc, markdownDoc(LIVE));
    const res = ratchet();
    expect(res.code).toBe(0);
    expect(res.stdout.match(/noop: /g)).toHaveLength(2);
    expect(fs.readFileSync(fixturesDoc, "utf-8")).toBe(bashDoc(LIVE));
    expect(fs.readFileSync(onboardingDoc, "utf-8")).toBe(markdownDoc(LIVE));
  });

  it("ratchet writes neither doc when one is missing its anchors", () => {
    const staleBash = bashDoc({ ...LIVE, suites: 500, listed: 500 });
    const brokenMd = markdownDoc(LIVE).replace("<!-- TEST_COUNT:END -->", "");
    fs.writeFileSync(fixturesDoc, staleBash);
    fs.writeFileSync(onboardingDoc, brokenMd);
    const res = ratchet();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("No docs were rewritten");
    expect(fs.readFileSync(fixturesDoc, "utf-8")).toBe(staleBash);
    expect(fs.readFileSync(onboardingDoc, "utf-8")).toBe(brokenMd);
  });
});

describe("committed test-count blocks (#2342)", () => {
  // The CI guard measures live Jest; this cheaper check runs in the normal
  // Test job and catches the two committed docs disagreeing with each other.
  const read = (rel: string): string =>
    fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");

  it("onboarding.md and TEST_VIDEO_FIXTURES.md report the same counts", () => {
    const fixtures = read("docs/TEST_VIDEO_FIXTURES.md");
    const onboarding = read("docs/onboarding.md");

    const fSuites = fixtures.match(
      /Test Suites:\s+\d+\s+passed,\s+(\d+)\s+total/,
    );
    const fTests = fixtures.match(
      /# → Tests:\s+(\d+)\s+passed,\s+(\d+)\s+skipped,\s+(\d+)\s+total/,
    );
    const oSuites = onboarding.match(/\*\*Test suites:\*\*\s+(\d+)/);
    const oTests = onboarding.match(
      /\*\*Test cases:\*\*\s+(\d+)\s+\((\d+)\s+passed\s+\+\s+(\d+)\s+skipped\)/,
    );

    expect(fSuites && fTests && oSuites && oTests).toBeTruthy();
    expect(oSuites![1]).toBe(fSuites![1]);
    expect(oTests![1]).toBe(fTests![3]); // total
    expect(oTests![2]).toBe(fTests![1]); // passed
    expect(oTests![3]).toBe(fTests![2]); // skipped
  });
});
