#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef, no-console */
/**
 * Stub Inventory Gate — Issue #1435
 *
 * Validates STUBS.md against the current source tree under `src/`. The
 * `Active stubs` table is the canonical inventory of placeholder / not-yet-
 * implemented surfaces, so any drift between the table and the filesystem
 * silently misleads contributors. This script enforces four invariants:
 *
 *   1. Every `File` column in the `Active stubs` table resolves to a path
 *      that exists under `src/` at HEAD. Missing paths fail the build.
 *   2. Any file under `src/` whose name matches `*stub*` or `*placeholder*`
 *      and that is NOT referenced by `STUBS.md` is reported as an untracked
 *      stub and fails the build.
 *   3. Any source file under `src/` (excluding `__tests__/`) that imports or
 *      calls `PlaceholderComponent` or `StubDebugBanner` without a matching
 *      `Active stubs` row fails the build. Catches "added a stub, forgot to
 *      register it" regressions.
 *   4. The `Verified` (date) column on every row is checked: a row whose date
 *      is older than 30 days produces a warning so audits are not silently
 *      skipped.
 *
 * The `Removed / promoted stubs` table is informational only and is not
 * re-checked — those rows are historical and the files may legitimately
 * no longer exist.
 *
 * Usage:  node scripts/stubs-inventory.js
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const STUBS_MD = path.join(REPO_ROOT, "STUBS.md");
const SRC_ROOT = path.join(REPO_ROOT, "src");

const STALE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

if (!fs.existsSync(STUBS_MD)) {
  console.error(`[stubs-inventory] FAIL: ${STUBS_MD} does not exist`);
  process.exit(1);
}
if (!fs.existsSync(SRC_ROOT)) {
  console.error(`[stubs-inventory] FAIL: ${SRC_ROOT} does not exist`);
  process.exit(1);
}

const source = fs.readFileSync(STUBS_MD, "utf8");

/**
 * Extract the `Active stubs` markdown table into structured rows. Each row
 * is `{ stubId, file, layer, status, verified, notes }`. Robust to:
 *   - extra/missing columns (we index by header name)
 *   - pipe characters inside cell values (we tolerate them by splitting on
 *     ` | ` with leading/trailing pipes stripped)
 *   - leading/trailing whitespace
 *
 * The script bails if the `Active stubs` header is missing entirely so the
 * CI signal is unambiguous.
 */
function extractActiveStubsTable(md) {
  const headerMatch = md.match(/^##\s+Active stubs\s*$/m);
  if (!headerMatch) {
    throw new Error(
      "[stubs-inventory] FAIL: `## Active stubs` heading not found in STUBS.md",
    );
  }
  const afterHeader = md.slice(headerMatch.index + headerMatch[0].length);
  // The table ends at the next `## ` heading or the end of the file.
  const endMatch = afterHeader.match(/^##\s+/m);
  const tableBlock = endMatch
    ? afterHeader.slice(0, endMatch.index)
    : afterHeader;

  const lines = tableBlock
    .split(/\r?\n/)
    .map((l) => l.replace(/^>+ ?/, "").trim()) // strip blockquote
    .filter((l) => l.startsWith("|"));

  if (lines.length < 3) {
    throw new Error(
      "[stubs-inventory] FAIL: `Active stubs` table is empty (need header + separator + ≥1 row)",
    );
  }

  const headerLine = lines[0];
  const separatorLine = lines[1];
  const dataLines = lines.slice(2);

  // Reject obviously-misformed rows: separator must be `|---|---|...|`
  if (!/^\|[\s\-:|]+\|$/.test(separatorLine)) {
    throw new Error(
      `[stubs-inventory] FAIL: malformed table separator: ${separatorLine}`,
    );
  }

  // Parse header into column names.
  const headers = headerLine
    .slice(1, -1)
    .split("|")
    .map((h) => h.trim().toLowerCase());
  const idx = (name) => {
    const i = headers.indexOf(name);
    if (i === -1) {
      throw new Error(
        `[stubs-inventory] FAIL: Active stubs table missing column \`${name}\``,
      );
    }
    return i;
  };

  const fileIdx = idx("file");
  const stubIdIdx = idx("stub id");
  const statusIdx = idx("status");
  const verifiedIdx = idx("verified");

  const rows = [];
  for (const line of dataLines) {
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < headers.length) {
      throw new Error(
        `[stubs-inventory] FAIL: row has ${cells.length} cells, expected ${headers.length}: ${line}`,
      );
    }
    rows.push({
      stubId: cells[stubIdIdx],
      file: cells[fileIdx],
      layer: cells[idx("layer")],
      status: cells[statusIdx],
      verified: cells[verifiedIdx],
      notes: cells[idx("notes")] || "",
    });
  }
  return rows;
}

const rows = extractActiveStubsTable(source);

const failures = [];
const warnings = [];

// (1) Every File path resolves to a path that exists under src/ at HEAD.
for (const row of rows) {
  // Strip optional leading `./` and backticks; the table documents `src/...`
  // paths literally.
  const cleaned = row.file.replace(/^[`]+|[`]+$/g, "");
  const abs = path.isAbsolute(cleaned)
    ? cleaned
    : path.join(REPO_ROOT, cleaned);
  if (!fs.existsSync(abs)) {
    failures.push(
      `[stubs-inventory] FAIL: stub \`${row.stubId}\` references missing file \`${row.file}\` (resolved: ${path.relative(REPO_ROOT, abs)})`,
    );
  }
}

// (2) Walk src/ for `*stub*` / `*placeholder*` files not referenced by STUBS.md.
function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const allFiles = walk(SRC_ROOT, []);
const referencedFiles = new Set(
  rows.map((r) => path.normalize(r.file.replace(/^[`]+|[`]+$/g, ""))),
);

// Files that legitimately match the filename regex but are NOT stub surfaces.
// `placeholder.tsx` is the meta-component that DEFINES `PlaceholderComponent`
// and `StubDebugBanner`; `placeholder-images*` are card-art image placeholder
// data, not stub UI surfaces.
const STUB_FILENAME_RE = /(stub|placeholder)/i;
const STUB_FILENAME_EXCLUDE = new Set(
  ["src/components/ui/placeholder.tsx"].map((p) => path.normalize(p)),
);
const PLACEHOLDER_IMAGE_DATA_RE = /placeholder-images/i;

for (const file of allFiles) {
  const rel = path.normalize(path.relative(REPO_ROOT, file));
  if (!STUB_FILENAME_RE.test(path.basename(file))) continue;
  if (STUB_FILENAME_EXCLUDE.has(rel)) continue;
  if (PLACEHOLDER_IMAGE_DATA_RE.test(path.basename(file))) continue;
  if (referencedFiles.has(rel)) continue;
  failures.push(
    `[stubs-inventory] FAIL: file \`${rel}\` matches \`*stub*\`/\`*placeholder*\` but is not listed in the Active stubs table`,
  );
}

// (3) Source files (outside __tests__) that import or call
//     PlaceholderComponent / StubDebugBanner without a matching Active stubs
//     row referencing them. The meta-component definition file is excluded
//     because it DEFINES those symbols rather than consuming them.
const PLACEHOLDER_CALL_RE = /PlaceholderComponent|StubDebugBanner/;
for (const file of allFiles) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const rel = path.normalize(path.relative(REPO_ROOT, file));
  if (STUB_FILENAME_EXCLUDE.has(rel)) continue;
  if (referencedFiles.has(rel)) continue;
  const content = fs.readFileSync(file, "utf8");
  if (!PLACEHOLDER_CALL_RE.test(content)) continue;
  failures.push(
    `[stubs-inventory] FAIL: \`${rel}\` calls PlaceholderComponent/StubDebugBanner but is not listed in the Active stubs table`,
  );
}

// (4) Verified date sanity check (warning, not failure).
const today = new Date();
for (const row of rows) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.verified);
  if (!m) {
    failures.push(
      `[stubs-inventory] FAIL: stub \`${row.stubId}\` has invalid Verified date \`${row.verified}\` (expected YYYY-MM-DD)`,
    );
    continue;
  }
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    failures.push(
      `[stubs-inventory] FAIL: stub \`${row.stubId}\` has unparseable Verified date \`${row.verified}\``,
    );
    continue;
  }
  const ageDays = (today.getTime() - d.getTime()) / MS_PER_DAY;
  if (ageDays > STALE_DAYS) {
    warnings.push(
      `[stubs-inventory] WARN: stub \`${row.stubId}\` Verified date is ${Math.floor(ageDays)} days old (threshold ${STALE_DAYS}); re-audit and bump the date`,
    );
  }
}

if (warnings.length > 0) {
  for (const w of warnings) console.warn(w);
}
if (failures.length > 0) {
  for (const f of failures) console.error(f);
  console.error(
    `[stubs-inventory] FAIL: ${failures.length} stub-inventory drift ${failures.length === 1 ? "issue" : "issues"}; ${warnings.length} warning(s).`,
  );
  process.exit(1);
}

console.log(
  `[stubs-inventory] OK: ${rows.length} Active stub row(s) verified, 0 failures, ${warnings.length} warning(s).`,
);
process.exit(0);
