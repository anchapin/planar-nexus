/**
 * Route-map coverage guard for issue #1911.
 *
 * `docs/API.md` section 2 ("Route map") is the documented source of truth for
 * the HTTP surface exposed by `src/app/api/.../route.ts` glob matches. Before #1911
 * the table omitted `/api/signaling/turn-credentials` even though the
 * underlying handler (added via #1583) shipped in production; this
 * test detects that class of drift (any `route.ts` file present under
 * `src/app/api/` whose URL path is not documented in the section-2 table)
 * and mirrors the test patterns used by
 * `tests/broken-links-guard.test.ts` (#1896),
 * `tests/coverage-docs-guard.test.ts` (#1712), and
 * `tests/engine-import-boundary.test.ts`.
 *
 * Mapping rules:
 *
 *   - The route tree is discovered at test time via a recursive
 *     directory walk of `<repo>/src/app/api/`. Every file named
 *     `route.ts` contributes one URL path: the directory containing
 *     it is converted from kebab-case nesting to the Next.js App
 *     Router URL form with a leading `/api` prefix. For the current
 *     tree this yields seven paths.
 *
 *   - The §2 route map is identified by the first markdown pipe
 *     table under the `### Route map` heading inside `docs/API.md`.
 *     The table has four columns: Method | Path | Purpose | Handler.
 *     Only the Method and Path columns are inspected.
 *
 *   - A route.ts file is considered covered when its URL path string
 *     matches the second column of at least one row (case-sensitive,
 *     exact match — paths are lower-case by convention). Different
 *     HTTP methods exported from one file (e.g.
 *     `src/app/api/signaling/route.ts` exposes GET + POST + DELETE)
 *     map to multiple rows but a single match is enough to certify
 *     coverage.
 *
 *   - For a stricter guard the test also fails when the table
 *     references a path with no matching `route.ts` file (catches
 *     deleted-but-undocumented removals).
 *
 * Contract (issue #1911):
 *
 *   - The committed repo state MUST produce zero failures (CI gates
 *     on this).
 *   - Adding a new `src/app/api/<route>/route.ts` without updating
 *     `docs/API.md` §2 MUST make this test fail with a clear diff.
 *   - Removing an existing route.ts file without removing its row
 *     MUST make this test fail with a clear diff.
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const API_SRC_ROOT = path.join(REPO_ROOT, "src", "app", "api");
const DOC_PATH = path.join(REPO_ROOT, "docs", "API.md");

interface RouteFile {
  relativeDir: string;
  absolutePath: string;
  urlPath: string;
}

/**
 * Recursively walk `<repo>/src/app/api/**` and return every `route.ts`
 * found, paired with the URL path the Next.js App Router would serve
 * it at (e.g. `signaling/turn-credentials/route.ts` →
 * `/api/signaling/turn-credentials`).
 *
 * Pure synchronous I/O — the route tree is small and stable across
 * the whole test run.
 */
function discoverRouteFiles(): RouteFile[] {
  const result: RouteFile[] = [];

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.isFile() && entry.name === "route.ts") {
        const relativeDir = path.relative(API_SRC_ROOT, path.dirname(absolute));
        const segments = relativeDir
          .split(path.sep)
          .filter((s) => s.length > 0);
        const urlPath = `/api/${segments.join("/")}`;
        result.push({
          relativeDir: relativeDir || ".",
          absolutePath: absolute,
          urlPath,
        });
      }
    }
  };

  if (!fs.existsSync(API_SRC_ROOT)) {
    throw new Error(
      `Route source root not found at ${API_SRC_ROOT}; ` +
        "cannot verify route-map coverage.",
    );
  }

  walk(API_SRC_ROOT);
  result.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
  return result;
}

interface TableRow {
  method: string;
  path: string;
  raw: string;
}

/**
 * Extract the §2 "Route map" table from `docs/API.md`. Returns the
 * data rows (header + separator are excluded). Each row yields a
 * Method + Path string, plus the original raw line for diagnostics.
 *
 * The route map is identified structurally: the first pipe table
 * preceded by a heading containing "Route map". The check is
 * intentionally local — §1, §2.1, etc. all use pipe tables too, so
 * a global scan would misidentify subsections.
 */
function extractRouteMapRows(docContent: string): TableRow[] {
  const lines = docContent.split(/\r?\n/);
  let inRouteMap = false;
  const rows: TableRow[] = [];

  for (const line of lines) {
    if (!inRouteMap) {
      if (/^#{1,6}\s+.*[Rr]oute\s+[Mm]ap/.test(line)) {
        inRouteMap = true;
      }
      continue;
    }
    // Stop scanning at the next heading or at the end of the table.
    if (/^#{1,6}\s+/.test(line)) break;
    if (!line.startsWith("|")) continue;

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .map((c) => {
        // Strip inline-code backticks (e.g. `"/api/ai-proxy"`) so the
        // path column compares cleanly against the bare URL the route
        // walker emits. Also drop a leading bullet artefact if any.
        if (c.length >= 2 && c.startsWith("`") && c.endsWith("`")) {
          return c.slice(1, -1);
        }
        return c;
      })
      .filter((c) => c.length > 0);

    if (cells.length < 2) continue;
    // Skip the markdown separator row (`| --- | --- | ... |`).
    if (/^:?-+:?$/.test(cells[0])) continue;
    // Skip the header row (first non-separator row whose first cell
    // is "Method"). Allow case-insensitive match for safety.
    if (cells[0].toLowerCase() === "method") continue;

    rows.push({
      method: cells[0],
      path: cells[1],
      raw: line,
    });
  }

  return rows;
}

describe("docs/API.md §2 Route map coverage (issue #1911)", () => {
  let routeFiles: RouteFile[];
  let documentedPaths: Set<string>;
  let rawDoc: string;

  beforeAll(() => {
    routeFiles = discoverRouteFiles();
    rawDoc = fs.readFileSync(DOC_PATH, "utf8");
    const rows = extractRouteMapRows(rawDoc);
    documentedPaths = new Set(rows.map((r) => r.path));
  });

  test("finds the route.ts tree under src/app/api", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  test("every src/app/api route.ts appears in the §2 route map", () => {
    const missing = routeFiles.filter(
      (file) => !documentedPaths.has(file.urlPath),
    );
    if (missing.length > 0) {
      throw new Error(
        `Route files present under src/app/api/ but missing from ` +
          `docs/API.md §2 Route map: ` +
          missing.map((m) => `${m.absolutePath} -> ${m.urlPath}`).join("; "),
      );
    }
    expect(missing).toEqual([]);
  });

  test("§2 route map has no path entries without a backing route.ts", () => {
    const filePaths = new Set(routeFiles.map((f) => f.urlPath));
    const orphans = [...documentedPaths].filter((p) => !filePaths.has(p));
    if (orphans.length > 0) {
      throw new Error(
        `Paths documented in docs/API.md §2 Route map with no ` +
          `backing src/app/api/**/route.ts file: ${orphans.join(", ")}`,
      );
    }
    expect(orphans).toEqual([]);
  });

  test("§1 Overview mentions seven route files exposing ten endpoints", () => {
    const lines = rawDoc.split(/\r?\n/);
    const overviewLines: string[] = [];
    let inOverview = false;
    for (const line of lines) {
      if (/^##\s+1\.\s+Overview/.test(line)) {
        inOverview = true;
        continue;
      }
      if (inOverview && /^##\s+/.test(line)) break;
      if (inOverview && line.trim().length > 0) {
        overviewLines.push(line);
      }
    }
    const overview = overviewLines.join("\n");

    expect(overview).toMatch(/seven route files exposing ten endpoints/);
  });
});
