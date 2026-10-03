/**
 * Unit tests for scripts/security/check-npm-audit.mjs (#2437).
 *
 * The gate runs `npm audit --json` in CI; here it is fed fixture audit JSON
 * via --audit-json so the tests stay offline and deterministic.
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT = path.join(
  __dirname,
  "..",
  "scripts",
  "security",
  "check-npm-audit.mjs",
);
const REAL_EXCEPTIONS = path.join(
  __dirname,
  "..",
  "scripts",
  "security",
  "npm-audit-exceptions.json",
);

const BRACES = {
  source: 1,
  name: "braces",
  dependency: "braces",
  title: "braces vulnerable to stack-exhaustion denial of service",
  url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
  severity: "high",
  range: "<=3.0.3",
};

function audit(vias: object[]) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      braces: { name: "braces", severity: "high", via: vias },
      micromatch: { name: "micromatch", severity: "high", via: ["braces"] },
    },
  };
}

function exceptions(entries: object[]) {
  return { exceptions: entries };
}

const BRACES_EXCEPTION = {
  id: "GHSA-vfj7-8cjw-p6xm",
  package: "braces",
  reason: "test",
  expires: "2026-10-16",
  issue: "https://github.com/anchapin/planar-nexus/issues/2437",
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-audit-gate-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(auditJson: object, exJson: object, today: string) {
  const a = path.join(dir, "audit.json");
  const e = path.join(dir, "exceptions.json");
  fs.writeFileSync(a, JSON.stringify(auditJson));
  fs.writeFileSync(e, JSON.stringify(exJson));
  const r = cp.spawnSync(
    process.execPath,
    [SCRIPT, "--audit-json", a, "--exceptions", e, "--today", today],
    { encoding: "utf8" },
  );
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("check-npm-audit gate", () => {
  it("fails on an unwaived high advisory", () => {
    const r = run(audit([BRACES]), exceptions([]), "2026-10-02");
    expect(r.code).toBe(1);
    expect(r.out).toContain("ghsa-vfj7-8cjw-p6xm");
  });

  it("passes when the advisory has a live exception", () => {
    const r = run(
      audit([BRACES]),
      exceptions([BRACES_EXCEPTION]),
      "2026-10-02",
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain("waived until 2026-10-16");
  });

  it("still passes on the expiry date itself", () => {
    const r = run(
      audit([BRACES]),
      exceptions([BRACES_EXCEPTION]),
      "2026-10-16",
    );
    expect(r.code).toBe(0);
  });

  it("fails once the exception has expired", () => {
    const r = run(
      audit([BRACES]),
      exceptions([BRACES_EXCEPTION]),
      "2026-10-17",
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("expired on 2026-10-16");
  });

  it("does not waive a different high advisory", () => {
    const other = {
      ...BRACES,
      name: "lodash",
      url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
    };
    const r = run(
      audit([BRACES, other]),
      exceptions([BRACES_EXCEPTION]),
      "2026-10-02",
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("ghsa-aaaa-bbbb-cccc");
    expect(r.out).not.toContain("error: high: braces");
  });

  it("does not waive the right id on the wrong package", () => {
    const r = run(
      audit([BRACES]),
      exceptions([{ ...BRACES_EXCEPTION, package: "minimatch" }]),
      "2026-10-02",
    );
    expect(r.code).toBe(1);
  });

  it("ignores moderate advisories", () => {
    const r = run(
      audit([{ ...BRACES, severity: "moderate" }]),
      exceptions([]),
      "2026-10-02",
    );
    expect(r.code).toBe(0);
  });

  it("warns, without failing, about an exception that no longer matches", () => {
    const r = run(audit([]), exceptions([BRACES_EXCEPTION]), "2026-10-02");
    expect(r.code).toBe(0);
    expect(r.out).toContain("no longer matches any advisory");
  });

  it("fails when npm audit itself errored", () => {
    const r = run(
      { error: { code: "ENOAUDIT", summary: "registry unreachable" } },
      exceptions([]),
      "2026-10-02",
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("registry unreachable");
  });

  it("requires every checked-in exception to have an expiry and a tracking issue", () => {
    const real = JSON.parse(
      fs.readFileSync(REAL_EXCEPTIONS, "utf8"),
    ).exceptions;
    expect(real.length).toBeGreaterThan(0);
    for (const ex of real) {
      expect(ex.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ex.issue).toMatch(
        /^https:\/\/github\.com\/anchapin\/planar-nexus\/issues\/\d+$/,
      );
      expect(ex.reason.length).toBeGreaterThan(20);
    }
  });
});
