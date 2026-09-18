/**
 * Integration tests for the issue #1896 broken markdown link guard
 * (`scripts/check-broken-links.mjs`).
 *
 * Mirrors the test pattern of `tests/jest-mock-boundary-guard.test.ts`
 * (#1815), `tests/coverage-docs-guard.test.ts` (#1712), and
 * `tests/e2e-asserts-guard.test.ts` (#1786, etc.): the guard is a
 * plain-Node script invoked by CI in its own job (wired to
 * `npm run lint:broken-links`). These tests spawn `node` against the
 * committed repo state (must PASS) and against fixture files in a temp
 * dir (must FAIL when a broken link is introduced, must PASS when the
 * gate's documented allowed forms are used).
 *
 * Contract summary (from issue #1896):
 *   - committed repo state MUST pass — this is the state CI gates on
 *   - a missing relative file target MUST fail with `missing-file`
 *   - a missing same-file anchor MUST fail with `broken-anchor`
 *   - a missing cross-file anchor MUST fail with `broken-anchor`
 *   - external URLs (http/https/mailto/tel) MUST be skipped (per the
 *     issue's "Out of scope: validating external URLs" line)
 *   - `--dry-run` MUST print the same report but always exit 0
 *   - `--json` MUST emit a JSON envelope with `ok` / `fileCount` /
 *     `externalLinkCount` / `brokenLinkCount` / `brokenLinks` keys
 *   - repo-root absolute paths (`/docs/foo.md`) MUST resolve against
 *     REPO_ROOT (acceptance criterion)
 *   - parent-traversal paths (`../../foo.md`) MUST resolve; if the
 *     resolved path escapes REPO_ROOT the gate reports `escapes-repo`
 *
 * Implementation note: ts-jest runs `.ts` test files through CJS, so
 * a static `import "../scripts/check-broken-links.mjs"` would trip
 * "Must use import to load ES Module". The script's helper exports
 * (`slugifyAnchor`, `classifyTarget`, `splitTarget`,
 * `extractLinkTargets`, `extractHeadingSlugs`) are therefore exercised
 * through a tiny `node -e` child process that imports the script and
 * JSON-serialises the result. That keeps the helper unit tests fast
 * (no need to spawn a full CLI per assertion) while honouring the
 * ESM/CJS boundary jest's runtime cannot bridge on its own.
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "yaml";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-broken-links.mjs");

interface GuardResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGuard(
  args: string[] = [],
  opts: { cwd?: string } = {},
): GuardResult {
  const proc = cp.spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf-8",
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, BROKEN_LINKS_REPO_ROOT: opts.cwd ?? REPO_ROOT },
  });
  return {
    code: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

/**
 * Run a snippet of JS in a child node process that imports the .mjs
 * script as ESM and JSON-serialises one helper's return value back.
 * Used to unit-test `slugifyAnchor`, `classifyTarget`, etc. without
 * pulling the ESM into jest's CJS runtime.
 *
 * The snippet MUST end by emitting a single JSON value on stdout. We
 * quote-embed the user input via JSON.stringify so backslashes /
 * quotes / newlines survive the round-trip.
 */
function callHelper(expression: string, helper: string, arg: string): unknown {
  const snippet = [
    `import { ${helper} } from ${JSON.stringify(SCRIPT)};`,
    `const arg = ${JSON.stringify(arg)};`,
    `process.stdout.write(JSON.stringify(${expression}));`,
  ].join("\n");
  const proc = cp.spawnSync(process.execPath, ["-e", snippet], {
    encoding: "utf-8",
  });
  if (proc.status !== 0) {
    throw new Error(
      `helper call failed: ${helper}(${JSON.stringify(arg)})\n` +
        `stdout: ${proc.stdout}\nstderr: ${proc.stderr}`,
    );
  }
  return JSON.parse(proc.stdout);
}

describe("check-broken-links helpers (issue #1896)", () => {
  it("slugifyAnchor lowercases, strips punctuation, preserves space-to-dash", () => {
    expect(
      callHelper(
        "slugifyAnchor(arg)",
        "slugifyAnchor",
        "8. Test Utilities (`@/test-utils`)",
      ),
    ).toBe("8-test-utilities-test-utils");
  });

  it("slugifyAnchor preserves the GFM double-dash from a stripped ampersand", () => {
    // "7.5 Coverage goals & the CI floor" — the `&` is stripped, the
    // surrounding spaces stay, and each becomes `-`, leaving "--".
    expect(
      callHelper(
        "slugifyAnchor(arg)",
        "slugifyAnchor",
        "7.5 Coverage goals & the CI floor",
      ),
    ).toBe("75-coverage-goals--the-ci-floor");
  });

  it("splitTarget handles path-only, path#anchor, and bare anchors", () => {
    expect(callHelper("splitTarget(arg)", "splitTarget", "./foo.md")).toEqual({
      path: "./foo.md",
      anchor: "",
    });
    expect(
      callHelper("splitTarget(arg)", "splitTarget", "./foo.md#bar"),
    ).toEqual({ path: "./foo.md", anchor: "bar" });
    expect(callHelper("splitTarget(arg)", "splitTarget", "#section")).toEqual({
      path: "",
      anchor: "section",
    });
  });

  it("classifyTarget separates external / anchor-only / file", () => {
    expect(
      callHelper(
        "classifyTarget(arg)",
        "classifyTarget",
        "https://example.com",
      ),
    ).toBe("external");
    expect(
      callHelper("classifyTarget(arg)", "classifyTarget", "http://example.com"),
    ).toBe("external");
    expect(
      callHelper("classifyTarget(arg)", "classifyTarget", "mailto:foo@bar"),
    ).toBe("external");
    expect(
      callHelper("classifyTarget(arg)", "classifyTarget", "tel:+15555555555"),
    ).toBe("external");
    expect(
      callHelper(
        "classifyTarget(arg)",
        "classifyTarget",
        "//cdn.example.com/foo",
      ),
    ).toBe("external");
    expect(
      callHelper("classifyTarget(arg)", "classifyTarget", "file:///etc/hosts"),
    ).toBe("external");
    expect(
      callHelper("classifyTarget(arg)", "classifyTarget", "#section"),
    ).toBe("anchor-only");
    expect(
      callHelper("classifyTarget(arg)", "classifyTarget", "./local.md"),
    ).toBe("file");
    expect(
      callHelper("classifyTarget(arg)", "classifyTarget", "/docs/local.md"),
    ).toBe("file");
  });

  it("extractLinkTargets ignores syntax inside fenced code blocks", () => {
    const src = [
      "# heading",
      "",
      "Valid: [ok](real.md)",
      "",
      "```markdown",
      "# Inside fence — NOT a real link",
      "[fake](does-not-exist.md)",
      "```",
      "",
      "After fence: [ok2](real.md)",
    ].join("\n");
    expect(
      callHelper("extractLinkTargets(arg)", "extractLinkTargets", src),
    ).toEqual([
      { line: 3, target: "real.md" },
      { line: 10, target: "real.md" },
    ]);
  });

  it("extractLinkTargets ignores syntax inside inline code", () => {
    const src = [
      "Real: [ok](real.md)",
      "Inline code: `[fake](does-not-exist.md)`",
    ].join("\n");
    expect(
      callHelper("extractLinkTargets(arg)", "extractLinkTargets", src),
    ).toEqual([{ line: 1, target: "real.md" }]);
  });

  it("extractHeadingSlugs walks ATX headings and skips fenced code", () => {
    const src = [
      "# Top",
      "",
      "## Section A",
      "",
      "```",
      "# This is not a heading",
      "```",
      "",
      "### Sub A.1",
    ].join("\n");
    const slugs = callHelper(
      "[...extractHeadingSlugs(arg)].sort()",
      "extractHeadingSlugs",
      src,
    ) as string[];
    expect(slugs).toEqual(["section-a", "sub-a1", "top"]);
  });

  it("extractHeadingSlugs strips inline markdown from heading text", () => {
    const slugs = callHelper(
      "[...extractHeadingSlugs(arg)]",
      "extractHeadingSlugs",
      "## `src/lib/foo.ts` is **great**",
    ) as string[];
    expect(slugs).toEqual(["srclibfoots-is-great"]);
  });

  it("extractLinkTargets resolves reference-style links against definitions", () => {
    const src = [
      "Uses [ref][foo] and [bar][] here.",
      "",
      "[foo]: ./first.md",
      "[bar]: ./second.md#section",
    ].join("\n");
    expect(
      callHelper("extractLinkTargets(arg)", "extractLinkTargets", src),
    ).toEqual([
      { line: 1, target: "./first.md" },
      { line: 1, target: "./second.md#section" },
    ]);
  });
});

describe("check-broken-links repo state (issue #1896 — CI baseline)", () => {
  jest.setTimeout(60_000);

  it("passes on the committed repo state", () => {
    const result = runGuard();
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/broken-links: OK/);
    expect(result.stdout).toMatch(/0 broken/);
  });
});

describe("check-broken-links CLI flags (issue #1896)", () => {
  jest.setTimeout(60_000);

  it("--help prints usage and exits 0", () => {
    const result = runGuard(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--json");
  });

  it("--json emits a JSON envelope even when the tree is clean", () => {
    const result = runGuard(["--json"]);
    expect(result.code).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.brokenLinkCount).toBe(0);
    expect(envelope.brokenLinks).toEqual([]);
    expect(typeof envelope.fileCount).toBe("number");
    expect(envelope.fileCount).toBeGreaterThan(100);
    expect(typeof envelope.externalLinkCount).toBe("number");
  });
});

describe("check-broken-links synthetic fixtures (issue #1896)", () => {
  jest.setTimeout(60_000);

  /**
   * Build a throwaway repo under `tmp` with one root .md file plus a
   * target .md so the guard has something real to point at. Returns
   * the tmp root and a cleanup thunk. The script's REPO_ROOT can be
   * overridden via BROKEN_LINKS_REPO_ROOT (mirrors the
   * JEST_MOCK_BOUNDARY_REPO_ROOT pattern from #1815), which is how
   * the test exercises a tiny synthetic tree without first copying
   * the script into the temp dir.
   */
  function makeTmpRepo(): { root: string; cleanup: () => void } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "broken-links-"));
    // Touch the canonical directory layout so `walk` has the same shape
    // as the real repo — without `docs/` the guard still walks the
    // root, but the second-pass invariant tests want it present.
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "README.md"),
      "# Top\n\n## Section A\n\na paragraph.\n",
    );
    fs.writeFileSync(
      path.join(root, "docs", "TARGET.md"),
      "# Target Heading\n\nText.\n\n## Sub\n\nMore text.\n",
    );
    return {
      root,
      cleanup: () => {
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  }

  function stage(root: string, relPath: string, body: string): void {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }

  function runInTmp(root: string, args: string[] = []): GuardResult {
    return runGuard(args, { cwd: root });
  }

  it("flags a missing relative file link", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(root, "README.md", "# Top\n\nSee [Target](docs/MISSING.md).\n");
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("missing-file");
      expect(result.stderr).toContain("docs/MISSING.md");
    } finally {
      cleanup();
    }
  });

  it("flags a missing same-file anchor", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(root, "README.md", "# Top\n\nSee [section](#does-not-exist).\n");
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("broken-anchor");
      expect(result.stderr).toContain("#does-not-exist");
    } finally {
      cleanup();
    }
  });

  it("flags a missing cross-file anchor", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(root, "README.md", "# Top\n\nSee [sub](./docs/TARGET.md#nope).\n");
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("broken-anchor");
      expect(result.stderr).toContain("#nope");
    } finally {
      cleanup();
    }
  });

  it("passes on a clean tree (every link + anchor resolves)", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(
        root,
        "README.md",
        [
          "# Top",
          "",
          "## Section A",
          "",
          "See [target](./docs/TARGET.md), [sub](./docs/TARGET.md#sub), [self](#section-a).",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/broken-links: OK/);
    } finally {
      cleanup();
    }
  });

  it("skips external URLs (http/https/mailto) without failing", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(
        root,
        "README.md",
        [
          "# Top",
          "",
          "[GH](https://github.com) [Email](mailto:foo@bar) [HTTP](http://example.com).",
        ].join("\n"),
      );
      const result = runInTmp(root, ["--json"]);
      expect(result.code).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(true);
      expect(envelope.externalLinkCount).toBe(3);
      expect(envelope.brokenLinkCount).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("rejects repo-root absolute paths that don't exist", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(root, "README.md", "# Top\n\nSee [ghost](/DOES_NOT_EXIST.md).\n");
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("missing-file");
    } finally {
      cleanup();
    }
  });

  it("accepts repo-root absolute paths that DO exist", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(root, "README.md", "# Top\n\nSee [target](/docs/TARGET.md).\n");
      const result = runInTmp(root);
      expect(result.code).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("flags parent traversal that escapes the repo root", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(
        root,
        "docs/SUB.md",
        "# Sub\n\nSee [escape](../../../etc/passwd).\n",
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("escapes-repo");
    } finally {
      cleanup();
    }
  });

  it("--dry-run prints the would-be report but exits 0", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(root, "README.md", "# Top\n\nSee [ghost](docs/MISSING.md).\n");
      const result = runInTmp(root, ["--dry-run"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("DRY-RUN");
      expect(result.stderr).toContain("docs/MISSING.md");
    } finally {
      cleanup();
    }
  });

  it("--json emits brokenLinks[] with file:line:target entries", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(
        root,
        "README.md",
        "# Top\n\nFirst [a](docs/A.md) then [b](docs/B.md).\n",
      );
      const result = runInTmp(root, ["--json"]);
      expect(result.code).toBe(1);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.brokenLinkCount).toBe(2);
      expect(envelope.brokenLinks).toHaveLength(2);
      const targets = envelope.brokenLinks.map(
        (b: { target: string }) => b.target,
      );
      expect(targets).toContain("docs/A.md");
      expect(targets).toContain("docs/B.md");
    } finally {
      cleanup();
    }
  });

  it("image links (![alt](path)) are checked the same as text links", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(root, "README.md", "![logo](missing.png)\n");
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("missing.png");
    } finally {
      cleanup();
    }
  });

  it("link syntax inside fenced code blocks is ignored", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(
        root,
        "README.md",
        [
          "# Top",
          "",
          "```md",
          "[fake](does-not-exist.md)",
          "```",
          "",
          "Real: [ok](./docs/TARGET.md).",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("link syntax inside inline code spans is ignored", () => {
    const { root, cleanup } = makeTmpRepo();
    try {
      stage(
        root,
        "README.md",
        "Real: [ok](./docs/TARGET.md). Fake: `[x](does-not-exist.md)`.\n",
      );
      const result = runInTmp(root);
      expect(result.code).toBe(0);
    } finally {
      cleanup();
    }
  });
});

describe("check-broken-links CI wiring (issue #1896)", () => {
  type WorkflowStep = { name?: unknown; run?: unknown };
  type WorkflowJob = { steps?: WorkflowStep[]; needs?: unknown };
  type Workflow = { jobs: Record<string, WorkflowJob> };

  function loadWorkflow(rel: string): Workflow {
    const abs = path.join(__dirname, "..", rel);
    return yaml.parse(fs.readFileSync(abs, "utf8")) as Workflow;
  }

  it("ci.yml runs the guard in its own job and gates build on it", () => {
    const ci = loadWorkflow(".github/workflows/ci.yml");

    const guardSteps = (ci.jobs["broken-links-guard"]?.steps ?? []).filter(
      (s) => s.run === "node scripts/check-broken-links.mjs",
    );
    expect(guardSteps).toHaveLength(1);

    const buildNeeds = ci.jobs["build"]?.needs;
    expect(Array.isArray(buildNeeds)).toBe(true);
    expect(buildNeeds).toContain("broken-links-guard");
  });

  it("package.json exposes lint:broken-links and it invokes the script", () => {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["lint:broken-links"]).toBe(
      "node scripts/check-broken-links.mjs",
    );
  });

  it("docs/TESTING.md mentions the new gate in the CI Integration section", () => {
    const testingPath = path.join(__dirname, "..", "docs", "TESTING.md");
    const body = fs.readFileSync(testingPath, "utf8");
    // Per the issue's "Documented in docs/TESTING.md ... one bullet
    // pointing to the new gate" acceptance criterion.
    expect(body).toMatch(/lint:broken-links/);
    expect(body).toMatch(/check-broken-links/);
  });
});
