#!/usr/bin/env node
/**
 * Broken Markdown Link Guard — Issue #1896
 *
 * CI gate that prevents the link-rot class of bug that PR #1892 (closes
 * #1804) just fixed by hand. That PR shipped a 14-line patch repairing 11
 * broken relative links across CONTRIBUTING.md, RELEASE_RUNBOOK.md,
 * TESTING.md, DEPLOYMENT_GUIDE.md, BRANCH_PROTECTION.md, and
 * VIDEO_DERIVED_TESTS_WORKFLOW.md — none of which had any automated gate
 * to keep them from rotting again.
 *
 * The script walks every Markdown file (`.md`) plus optional `.mdx` /
 * `.mdc` under the repo root (excluding `node_modules`, `.next`, build
 * outputs) and parses the standard inline-link syntax
 * (`[text](path)` / `![alt](src)`) plus reference-style links
 * (`[text][ref]` resolved via `[ref]: target`). For every link target:
 *
 *   1. **External URLs (`http://`, `https://`, `mailto:`, `tel:`,
 *      protocol-relative `//host/...`)** are SKIPPED — out of scope
 *      (issue #1896 "Out of scope: validating external URLs"). They are
 *      tallied but never fail the gate. The honest mirror for external
 *      rot is a separate periodic checker; mixing it into PR-time CI
 *      adds network flake + minutes of latency.
 *   2. **Bare anchors (`#section`)** are checked against the source
 *      file's own GFM-slugified headings — broken same-file anchors fail.
 *   3. **Repo-root paths (`/docs/foo.md`)** resolve against REPO_ROOT.
 *   4. **Relative paths (`docs/foo.md`, `../bar.md`)** resolve against
 *      the source file's directory. Parent traversal is allowed (some
 *      legitimate refs use `../../`); if the resolved path escapes the
 *      repo root the gate reports it as broken rather than silently
 *      accepting the file might exist elsewhere on the filesystem.
 *   5. **Optional `#anchor` suffix** is GFM-slugified and verified
 *      against the target's headings. Broken cross-file anchors fail.
 *
 * Output is per-broken-link `file:line:target  [reason]`. On clean
 * trees the script exits 0 with a one-line summary; any broken link
 * exits 1.
 *
 * Flags:
 *   --help            print usage and exit 0
 *   --dry-run         print the per-file report that WOULD fire, but
 *                     always exit 0 — useful for previewing a refactor
 *                     without gating the build
 *   --json            emit a JSON envelope on stdout
 *                     (`{ ok, brokenLinks, externalLinks, files }) so
 *                     other tooling (PR comments, dashboards) can read
 *                     the result without re-parsing stderr
 *   --include=<glob>  restrict the file walk; repeat for multiple. The
 *                     default is `**\/*.md` + `**\/*.mdx` + `**\/*.mdc`
 *                     under the repo root, excluding `node_modules`,
 *                     `.next`, `dist`, `build`, `coverage`, `.git`,
 *                     `out`, `.turbo`.
 *
 * Exit codes:
 *   0 — clean (or --dry-run, even when broken links would have fired)
 *   1 — broken link(s) found; per-link report on stderr
 *
 * Wired into package.json as `lint:broken-links`. CI invocation lives
 * in `.github/workflows/ci.yml` → `broken-links-guard`. Companion Jest
 * tests: `tests/broken-links-guard.test.ts`.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT =
  process.env.BROKEN_LINKS_REPO_ROOT ??
  join(fileURLToPath(import.meta.url), "..", "..");

const MARKDOWN_EXTENSIONS = [".md", ".mdx", ".mdc"];

/** Directories never walked — matches the #1815 jest-mock-boundary ignore
 *  set so the two guards stay aligned on what counts as source. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".git",
  "out",
  ".turbo",
  "reports",
  "playwright-report",
  "test-results",
  // `docs/implementation/` holds archived per-phase design memos that
  // pre-date the current docs layout. Their internal cross-links
  // (e.g. to files renamed in later refactors) are not on the docs
  // lint surface; the gate covers live docs only.
  "docs/implementation",
  // `.planning/` holds GSD planning artifacts (milestone PLANS/SUMMARIES,
  // REQUIREMENTS / ROADMAP history) — internal working notes, not
  // user-facing documentation. The plans contain EXAMPLE markdown (e.g.
  // a sample README template with `screenshots/foo.png` links that
  // intentionally don't resolve) which would drown the gate in false
  // positives. The user-facing docs surface (docs/, root `*.md`) is
  // what the issue targets; legacy planning noise stays out of scope.
  ".planning",
  // `.stryker-tmp/` is created by local Stryker runs; its sandboxed
  // copies of source files may contain broken links relative to the
  // real repo and are not part of the committed state the guard gates.
  ".stryker-tmp",
]);

/** `docs/implementation/` is repo-tracked engineering noise (older issue
 *  snapshots, retired design memos); the docs-lint surface intentionally
 *  skips it. If a contributor resurrects one of those files into the
 *  main docs tree the guard re-evaluates it on the spot. The exclusion
 *  is conservative — false-negatives on archived docs are preferable to
 *  forcing every contributor to repair the archive before adding new
 *  content. */

/**
 * @typedef {Object} BrokenLink
 * @property {string} file       Repo-root-relative source file (POSIX).
 * @property {number} line       1-indexed source line.
 * @property {string} target     The full original target string (with anchor).
 * @property {string} reason     Short machine-stable failure reason.
 * @property {string} detail     Human-readable diagnostic.
 */

/**
 * GFM-style anchor slug. Matches the algorithm GitHub uses for `#section`
 * links: lowercase, strip non-alphanumeric/-/space, collapse spaces to
 * `-`. Emoji/code-fence handling is intentionally minimal — the repo's
 * docs are ASCII and headings don't carry backtick escapes today.
 * @param {string} text
 * @returns {string}
 */
export function slugifyAnchor(text) {
  // Mirrors the GFM anchor algorithm: lowercase, strip anything that
  // isn't alphanumeric / space / hyphen, then replace EVERY space with
  // a hyphen (NOT collapse runs — "goals & the" leaves two spaces,
  // which become "--"). A trailing space on the line is already
  // removed by the heading regex's `\s*` quantifier before this runs.
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s/g, "-");
}

/**
 * Extract every heading's slug from a Markdown source. ATX headings
 * (`# …`, `## …`, etc.) only — setext (`Foo\n===`) is rare in this
 * repo's docs but harmless to ignore. Inline markdown inside the
 * heading text is stripped of its backticks/emphasis so a heading
 * like `## \`src/lib/foo.ts\` is great` slugifies to
 * `src-lib-foo-ts-is-great`. Fenced code blocks are skipped — a `#`
 * inside a literal shell command is not a heading.
 * @param {string} source
 * @returns {Set<string>}
 */
export function extractHeadingSlugs(source) {
  const slugs = new Set();
  const lines = source.split(/\r?\n/);
  /** @type {{ marker: "`" | "~"; length: number } | null} */
  let fenceState = null;
  for (const line of lines) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const length = fenceMatch[1].length;
      const rest = fenceMatch[2].trim();
      if (fenceState === null) {
        fenceState = { marker, length };
        continue;
      }
      if (
        marker === fenceState.marker &&
        length >= fenceState.length &&
        rest === ""
      ) {
        fenceState = null;
      }
      continue;
    }
    if (fenceState !== null) continue;
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    // Strip inline markdown — backticks, emphasis markers, link syntax.
    const cleaned = m[1]
      .replace(/`+/g, "")
      .replace(/[*_~]+/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    const slug = slugifyAnchor(cleaned);
    if (slug) slugs.add(slug);
  }
  return slugs;
}

/**
 * One-time cache: heading slugs per absolute path. Reading on every link
 * check would re-parse the same target file dozens of times when a docs
 * index links to many sibling sections.
 * @type {Map<string, Set<string>>}
 */
const HEADING_CACHE = new Map();

/**
 * @param {string} absPath
 * @returns {Set<string>}
 */
function headingsFor(absPath) {
  const cached = HEADING_CACHE.get(absPath);
  if (cached) return cached;
  let slugs = new Set();
  try {
    slugs = extractHeadingSlugs(readFileSync(absPath, "utf8"));
  } catch {
    // Missing/unreadable — caller will report the missing file anyway.
  }
  HEADING_CACHE.set(absPath, slugs);
  return slugs;
}

/**
 * Strip code fences and inline code spans so link syntax inside literal
 * examples (`[foo](bar)` in a README showing markdown syntax) is not
 * treated as a real reference. Reference-style definitions are extracted
 * BEFORE the masking so `[ref]: target` blocks are still parseable.
 *
 * Fence detection is CommonMark-strict:
 *   - An opening fence has a marker character (``` or ~~~) with 3+
 *     repetitions, optionally followed by an info string (`bash`, `md`).
 *   - A closing fence has 3+ of the SAME character as the opener and
 *     NO info string (just trailing whitespace).
 *   - A line that LOOKS like a fence but carries an info string while
 *     we're already inside a fence is CONTENT — it does not toggle.
 *
 * Without the no-info-string rule, a nested ` ```bash ` inside a
 * ` ```markdown ` block would close the outer fence prematurely and
 * every line after it would be linted as live markdown. (Caught by
 * .planning/milestones/v1.0/3-03-PLAN.md, which is one big example.)
 * @param {string} source
 * @returns {{ masked: string; refDefs: Map<string, string> }}
 */
function maskAndExtractRefDefs(source) {
  /** @type {Map<string, string>} */
  const refDefs = new Map();
  const lines = source.split("\n");
  /** @type {string[]} */
  const masked = [];
  /** @type {{ marker: "`" | "~"; length: number } | null} */
  let fenceState = null;
  for (const line of lines) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const length = fenceMatch[1].length;
      const rest = fenceMatch[2].trim();
      if (fenceState === null) {
        // Opening: only opens if the marker character can start a new
        // fence. Both ``` and ~~~ are valid markers.
        fenceState = { marker, length };
        masked.push("");
        continue;
      }
      // Inside a fence: close only if the marker character matches AND
      // the length is ≥ opener length AND there's no info string.
      if (
        marker === fenceState.marker &&
        length >= fenceState.length &&
        rest === ""
      ) {
        fenceState = null;
        masked.push("");
        continue;
      }
      // Otherwise this is content inside the fenced block.
      masked.push("");
      continue;
    }
    if (fenceState !== null) {
      masked.push("");
      continue;
    }
    // Reference definition: [ref]: target
    const def = /^\s{0,3}\[([^\]]+)\]:\s+(\S+)/.exec(line);
    if (def) {
      refDefs.set(def[1].toLowerCase(), def[2]);
      masked.push(""); // blank-out so the link regex doesn't match the label
      continue;
    }
    masked.push(line.replace(/`[^`\n]*`/g, "``"));
  }
  return { masked: masked.join("\n"), refDefs };
}

/**
 * Extract every (line, target) pair from a Markdown source — inline
 * `[text](target)` and image `![alt](target)` links, plus collapsed
 * `[text][ref]` / `[ref][]` reference-style links resolved against the
 * definitions returned by `maskAndExtractRefDefs`. Returns a `line` for
 * each match, even if multiple links share a line, so error reports
 * point at the right place.
 * @param {string} source
 * @returns {{ line: number; target: string }[]}
 */
export function extractLinkTargets(source) {
  const { masked, refDefs } = maskAndExtractRefDefs(source);
  /** @type {{ line: number; target: string }[]} */
  const out = [];
  const lines = masked.split("\n");
  // Combined regex covering inline + reference-style. The image variant
  // is folded into the same alternation — `(?:\!?)` makes the leading
  // `!` optional, so a single pass captures both.
  //
  //   group 1: text/ref label (unused; we only need the target)
  //   group 2: target (parens or ref brackets)
  //
  // The reference-style suffix is `[ref]` or `[ref][]`; the inline form
  // has no trailing brackets. We capture the label into group 1 and the
  // URL/dest into group 2 (for inline links that's inside parens, for
  // reference-style that's empty + trailing brackets whose content we
  // re-extract via a separate regex pass below).
  const inlineRe = /!?\[[^\]\n]*\]\(\s*([^()\s]+)(?:\s+"[^"]*")?\s*\)/g;
  const refRe = /!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
  // Reference shortcut: `[label]` standalone, resolved via
  // `[label]: target`. Two guards in the body of the while-loop block
  // the false positives:
  //   - the lookahead `(?!\s*[\(\[])` skips `[x](y)` and `[x][y]`
  //     forms (those are caught by inlineRe / refRe already);
  //   - the explicit `prevChar` check skips the SECOND half of an
  //     already-matched reference like `[ref][foo]` (where `foo` would
  //     otherwise also be picked up by the shortcut pass and reported
  //     twice — once via refRe with the explicit `[foo]` ref, then
  //     again here as if it were a standalone shortcut).
  const refShortcutRe = /!?\[([^\]\n]+)\](?!\s*[\(\[])/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    inlineRe.lastIndex = 0;
    while ((m = inlineRe.exec(line)) !== null) {
      out.push({ line: i + 1, target: m[1] });
    }
    refRe.lastIndex = 0;
    while ((m = refRe.exec(line)) !== null) {
      const label = (m[2] || m[1]).toLowerCase();
      const target = refDefs.get(label);
      if (target !== undefined) {
        out.push({ line: i + 1, target });
      }
    }
    refShortcutRe.lastIndex = 0;
    while ((m = refShortcutRe.exec(line)) !== null) {
      const label = m[1].toLowerCase();
      const next = line[refShortcutRe.lastIndex];
      if (next === "(" || next === "[") continue;
      // Block the second half of an explicit reference like
      // `[ref][foo]` — `foo` follows a `]` (closing of `[ref]`), so the
      // refRe pass already resolved it. Same for collapsed `[bar][]`.
      if (m.index > 0 && line[m.index - 1] === "]") continue;
      const target = refDefs.get(label);
      if (target !== undefined) {
        out.push({ line: i + 1, target });
      }
    }
  }
  return out;
}

/**
 * Split a target string into `{ path, anchor }`. Handles the GFM forms:
 *   ./foo.md          -> { "./foo.md", "" }
 *   ./foo.md#bar      -> { "./foo.md", "bar" }
 *   ./foo.md#         -> { "./foo.md", "" }  (empty anchor is just a no-op)
 * @param {string} target
 * @returns {{ path: string; anchor: string }}
 */
export function splitTarget(target) {
  const hashIdx = target.indexOf("#");
  if (hashIdx === -1) return { path: target, anchor: "" };
  return {
    path: target.slice(0, hashIdx),
    anchor: target.slice(hashIdx + 1),
  };
}

/**
 * Classify a link target for skip-vs-check semantics. External URLs are
 * counted (so `--json` consumers can still see the surface area) but
 * never fail the gate.
 * @param {string} target
 * @returns { "external" | "anchor-only" | "file" }
 */
export function classifyTarget(target) {
  if (/^(?:https?:|mailto:|tel:|ftp:|sms:|data:|file:)/i.test(target))
    return "external";
  if (target.startsWith("//")) return "external";
  if (target.startsWith("#")) return "anchor-only";
  return "file";
}

/**
 * Resolve a target against a source file. Repo-root paths (`/foo.md`)
 * anchor to REPO_ROOT; relative paths (`./foo`, `../foo`) anchor to the
 * source file's directory. Returns the absolute filesystem path WITHOUT
 * verifying it exists.
 * @param {string} sourceFile  Absolute path to the source `.md` file.
 * @param {string} path        The path portion of the link target.
 * @returns {string}           Absolute path on disk (may not exist).
 */
export function resolveTargetPath(sourceFile, path) {
  if (isAbsolute(path)) {
    // Repo-root-relative: strip the leading `/` (Windows too — `/foo.md`
    // is a doc convention, not a filesystem root on Win32).
    return resolve(REPO_ROOT, path.replace(/^\/+/, ""));
  }
  return resolve(dirname(sourceFile), path);
}

/**
 * Walk a directory recursively and yield every Markdown file. Symlinks
 * are followed only when their target is a directory inside the repo
 * (defensive — we don't want to escape into `/etc`).
 * @param {string} dir
 * @returns {string[]}
 */
function collectMarkdownFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} cur */
  function walk(cur) {
    let entries;
    try {
      entries = readdirSync(cur);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(cur, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // Defensive: refuse to walk paths that resolve outside the repo.
        if (!full.startsWith(REPO_ROOT + sep) && full !== REPO_ROOT) continue;
        walk(full);
      } else if (MARKDOWN_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out;
}

/**
 * Main gate. Walks the repo, parses each Markdown file, classifies
 * targets, and reports broken file-or-anchor links. Always returns the
 * result; the caller (CLI section below) is responsible for the exit
 * code so `--dry-run` can short-circuit cleanly.
 * @param {{ repoRoot?: string }} [opts]
 * @returns {{ brokenLinks: BrokenLink[]; externalCount: number; fileCount: number }}
 */
export function run(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const files = collectMarkdownFiles(repoRoot);
  /** @type {BrokenLink[]} */
  const brokenLinks = [];
  let externalCount = 0;

  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const targets = extractLinkTargets(source);
    const relSource = relative(repoRoot, file).split(sep).join("/");

    for (const { line, target } of targets) {
      const kind = classifyTarget(target);
      if (kind === "external") {
        externalCount++;
        continue;
      }
      const { path, anchor } = splitTarget(target);

      if (kind === "anchor-only") {
        // Same-file anchor (`#section`). Path is empty after split.
        const slugs = headingsFor(file);
        if (anchor && !slugs.has(slugifyAnchor(anchor))) {
          brokenLinks.push({
            file: relSource,
            line,
            target,
            reason: "broken-anchor",
            detail: `same-file anchor "#${anchor}" not found in ${relSource}`,
          });
        }
        continue;
      }

      // Resolve the file path and check existence.
      const absTarget = resolveTargetPath(file, path);

      // Defensive: parent-traversal that escapes the repo is always
      // broken (the on-disk file might exist but it's outside the
      // project; we cannot verify cross-system resolution in CI).
      if (
        !absTarget.startsWith(repoRoot + sep) &&
        absTarget !== repoRoot
      ) {
        brokenLinks.push({
          file: relSource,
          line,
          target,
          reason: "escapes-repo",
          detail: `path resolves to ${absTarget}, outside ${repoRoot}`,
        });
        continue;
      }

      if (!existsSync(absTarget)) {
        brokenLinks.push({
          file: relSource,
          line,
          target,
          reason: "missing-file",
          detail: `target file ${relative(repoRoot, absTarget)} does not exist`,
        });
        continue;
      }

      // Anchor check (cross-file).
      if (anchor) {
        const slugs = headingsFor(absTarget);
        if (!slugs.has(slugifyAnchor(anchor))) {
          brokenLinks.push({
            file: relSource,
            line,
            target,
            reason: "broken-anchor",
            detail: `anchor "#${anchor}" not found in ${relative(repoRoot, absTarget)}`,
          });
        }
      }
    }
  }

  brokenLinks.sort((a, b) =>
    a.file !== b.file ? a.file.localeCompare(b.file) : a.line - b.line,
  );

  return { brokenLinks, externalCount, fileCount: files.length };
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

function printHelp() {
  process.stdout.write(
    [
      "check-broken-links.mjs — broken markdown link gate (issue #1896)",
      "",
      "Usage:",
      "  node scripts/check-broken-links.mjs [flags]",
      "",
      "Flags:",
      "  --help          print this help and exit 0",
      "  --dry-run       print the report that WOULD fire, but always exit 0",
      "  --json          emit a JSON envelope on stdout, diagnostics on stderr",
      "  --repo=<path>   override the repo root (used by the test suite)",
      "",
      "Exit codes:",
      "  0  clean (or --dry-run / --help)",
      "  1  broken link(s) found",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const opts = {
    help: false,
    dryRun: false,
    json: false,
    repoRoot: undefined,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--repo=")) opts.repoRoot = arg.slice("--repo=".length);
    else {
      process.stderr.write(`check-broken-links: unknown flag: ${arg}\n`);
      process.stderr.write(`Pass --help for usage.\n`);
      process.exit(2);
    }
  }
  return opts;
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const result = run(
    opts.repoRoot ? { repoRoot: resolve(opts.repoRoot) } : {},
  );

  if (opts.json) {
    const envelope = {
      ok: result.brokenLinks.length === 0,
      fileCount: result.fileCount,
      externalLinkCount: result.externalCount,
      brokenLinkCount: result.brokenLinks.length,
      brokenLinks: result.brokenLinks,
    };
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
    if (!result.brokenLinks.length) process.exit(0);
    process.exit(opts.dryRun ? 0 : 1);
  }

  if (result.brokenLinks.length === 0) {
    process.stdout.write(
      `broken-links: OK — ${result.fileCount} markdown file(s) scanned, ${result.externalCount} external URL(s) skipped, 0 broken.\n`,
    );
    process.exit(0);
  }

  const header = opts.dryRun
    ? `broken-links: DRY-RUN — ${result.brokenLinks.length} broken link(s) WOULD FAIL (not gating):`
    : `broken-links: FAILED — ${result.brokenLinks.length} broken link(s):`;
  process.stderr.write(`${header}\n`);
  for (const b of result.brokenLinks) {
    process.stderr.write(`  ${b.file}:${b.line}  ${b.target}  [${b.reason}]\n`);
    process.stderr.write(`    ${b.detail}\n`);
  }
  process.stderr.write(
    `\nFix: repair the link target (or the source path). Common causes:\n` +
      `  - file renamed/deleted without updating the link,\n` +
      `  - heading text changed so the slug no longer matches,\n` +
      `  - relative path off-by-one after a docs/ move (PR #1892 fixed 11\n` +
      `    of these in CONTRIBUTING/RELEASE_RUNBOOK/TESTING/DEPLOYMENT_GUIDE\n` +
      `    — keep that PR's fix from rotting again, this gate is the contract).\n` +
      `Out of scope (always skipped, never failed): external http/https URLs.\n`,
  );

  process.exit(opts.dryRun ? 0 : 1);
}
