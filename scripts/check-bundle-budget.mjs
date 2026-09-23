#!/usr/bin/env node
/**
 * Client Bundle Size Budget Gate — Issue #1814
 *
 * CI gate over the COMPILED client payload: fails when any route's
 * First Load JS exceeds its recorded budget in config/bundle-budget.json.
 * Before this gate nothing watched the compiled output — no bundle
 * analyzer, size-limit, or per-route budget — so a single careless
 * import could silently add hundreds of KB to a route with no CI
 * signal.
 *
 * MECHANISM — build-manifest artifacts, NOT `next build` stdout:
 *   Next.js 16.3.4 builds with Turbopack, which prints no per-route
 *   "First Load JS" column at all (the route table only marks static
 *   vs dynamic), so stdout parsing is not viable. The webpack-era
 *   `.next/app-build-manifest.json` (routes → chunks) is likewise NOT
 *   emitted under Turbopack. Instead, after `npm run build`, this
 *   script reads only stable build artifacts from `.next/`:
 *
 *   1. `app-path-routes-manifest.json` enumerates every public route
 *      (internal segment path → URL). Route handlers — internal keys
 *      ending in `/route` (all of `/api/*` plus `/favicon.ico`) — are
 *      skipped: they ship no page payload.
 *   2. Prerendered static routes: `server/app/<route>.html` — the sum
 *      of raw byte sizes of the unique `<script src>` files is the
 *      exact script set the browser downloads and executes on first
 *      paint (shared runtime + route chunks). This is ground truth.
 *   3. Dynamic client routes with no HTML (e.g. `/game/[id]`): the
 *      union of chunk URLs string-matched from the route's
 *      `page_client-reference-manifest.js`, plus the shared runtime
 *      (`rootMainFiles` + `polyfillFiles` from `build-manifest.json`).
 *      Deterministic, bundler-internal-format-agnostic (plain regex
 *      over chunk URL string literals), and conservative — it may
 *      include client chunks that only load lazily, so it can
 *      overcount but never undercount.
 *
 *   Sizes are RAW UNCOMPRESSED bytes (classic "First Load JS"
 *   semantics — what the server sends before transport compression,
 *   not gzip). `--capture` rounds each entry UP to the next whole kB,
 *   giving ≤1 kB headroom against cross-runner byte noise while the
 *   over-budget comparison itself stays strict.
 *
 * RATCHET — budgets are monotonic non-increasing in practice:
 *   - actual > budget                        → FAIL (over budget)
 *   - budget − actual > RATCHET_SLACK_BYTES  → FAIL (stale-high budget;
 *     the route slimmed down — re-capture so the new lower size
 *     becomes the ceiling; 10 kB slack absorbs ordinary chunk-layout
 *     drift without forcing a re-capture on every merge)
 *   - built route with no budget entry       → FAIL (new route — add a
 *     budget; deleting an entry for a live route hits this same rule)
 *   - budget entry for a route no longer built → FAIL (stale entry —
 *     removing a route from the budget file requires the route to be
 *     gone from the build; re-capture)
 *
 * Exit codes:
 *   0 — all routes within budget, budget file in sync with the build
 *   1 — any failure class above, or `.next/` is missing/stale
 *
 * Usage:
 *   node scripts/check-bundle-budget.mjs            # gate (default: --check)
 *   node scripts/check-bundle-budget.mjs --check    # explicit gate
 *   node scripts/check-bundle-budget.mjs --capture  # regenerate
 *       config/bundle-budget.json from the current build
 *       (maintainer tool — run after intentional size changes, and
 *       ONLY downward in practice; the ratchet above enforces it)
 *
 * Wired into package.json as `check:bundle-budget` (+ `:capture`) and
 * run by the CI job `bundle-size-budget` (.github/workflows/ci.yml),
 * which performs the full `npm run build` first — minutes of runtime,
 * accepted (issue #1814).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const NEXT_DIR = join(REPO_ROOT, ".next");
const BUDGET_FILE = join(REPO_ROOT, "config", "bundle-budget.json");

/** Allowed gap between a recorded budget and a slimmer reality (bytes). */
const RATCHET_SLACK_BYTES = 10 * 1024;

/**
 * Small tolerance threshold to absorb build artifact variation (timestamps,
 * hashes, compression ratios) that cause uniform small overages across all
 * routes without any actual code changes. Set to 3% — enough to handle the
 * 0.7–1.7 kB overages seen in issue #2130 without masking real regressions.
 */
const TOLERANCE_FRACTION = 0.03;

/** URL prefix for static assets inside prerendered HTML / manifests. */
const NEXT_URL_PREFIX = "/_next/";

/**
 * Format bytes as kB for report tables.
 * @param {number} bytes
 * @returns {string}
 */
function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * Fail loudly on a missing/unusable build output.
 * @param {string} message
 * @returns {never}
 */
function failBuild(message) {
  console.error(`bundle-budget: FAILED — ${message}`);
  process.exit(1);
}

if (!existsSync(NEXT_DIR) || !statSync(NEXT_DIR).isDirectory()) {
  failBuild(
    `no ${join(".", ".next")} directory found. Run \`npm run build\` first — ` +
      `budgets are measured against compiled output, not source.`
  );
}

/**
 * Parse a JSON file under .next/ with a targeted error message.
 * @param {string} relPath - path relative to .next/
 * @returns {any}
 */
function readNextJson(relPath) {
  const full = join(NEXT_DIR, relPath);
  if (!existsSync(full)) {
    failBuild(
      `\`${relPath}\` is missing from the build output — the manifest ` +
        `format this gate depends on may have changed (Next.js upgrade?). ` +
        `Re-verify scripts/check-bundle-budget.mjs against the new output.`
    );
  }
  return JSON.parse(readFileSync(full, "utf8"));
}

/**
 * Raw byte size of a file inside .next/, given a path relative to .next/.
 * Chunk URLs from HTML use the /_next/ prefix and are normalized first.
 * @param {string} relPath
 * @returns {number}
 */
function nextFileSize(relPath) {
  const normalized = relPath.startsWith(NEXT_URL_PREFIX)
    ? relPath.slice(NEXT_URL_PREFIX.length)
    : relPath;
  const full = join(NEXT_DIR, normalized);
  if (!existsSync(full)) {
    failBuild(
      `chunk \`${normalized}\` referenced by the build output does not ` +
        `exist on disk — the build directory is inconsistent. Re-run \`npm run build\`.`
    );
  }
  return statSync(full).size;
}

/**
 * Enumerate the client routes to measure.
 *
 * Source of truth: app-path-routes-manifest.json (internal segment path
 * → public URL). Route handlers (internal key ending in "/route": every
 * /api/* endpoint plus /favicon.ico) are excluded — they produce no
 * page payload. Every other entry is a page route the browser loads.
 * @returns {{ publicPath: string, internalPath: string }[]}
 */
function enumerateClientRoutes() {
  const manifest = readNextJson("app-path-routes-manifest.json");
  /** @type {{ publicPath: string, internalPath: string }[]} */
  const routes = [];
  for (const [internalPath, publicPath] of Object.entries(manifest)) {
    if (internalPath.endsWith("/route")) continue; // route handlers: no client payload
    routes.push({ publicPath, internalPath });
  }
  routes.sort((a, b) => (a.publicPath < b.publicPath ? -1 : 1));
  return routes;
}

/**
 * Measure a prerendered route: sum of raw byte sizes of the unique
 * `<script src>` files in its server/app/<route>.html. This is exactly
 * the script set the browser downloads and executes on first paint.
 * @param {string} publicPath
 * @returns {number}
 */
function measureHtmlRoute(publicPath) {
  const flat = publicPath === "/" ? "index" : publicPath.slice(1);
  const htmlPath = join(NEXT_DIR, "server", "app", `${flat}.html`);
  if (!existsSync(htmlPath)) return -1; // not prerendered — dynamic route
  const html = readFileSync(htmlPath, "utf8");
  /** @type {Set<string>} */
  const srcs = new Set();
  for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)) {
    srcs.add(match[1]);
  }
  let total = 0;
  for (const src of srcs) total += nextFileSize(src);
  return total;
}

/**
 * Measure a dynamic (server-rendered on demand) client route: union of
 * chunk URL string literals in its page client-reference-manifest.js,
 * plus the shared runtime files every page loads (rootMainFiles +
 * polyfillFiles from build-manifest.json). See header caveat: may
 * overcount lazily-loaded client chunks — conservative by design.
 * @param {string} internalPath
 * @returns {number}
 */
function measureDynamicRoute(internalPath) {
  const segmentDir = internalPath.replace(/\/page$/, "");
  const crmPath = join(NEXT_DIR, "server", "app", segmentDir, "page_client-reference-manifest.js");
  /** @type {Set<string>} */
  const chunks = new Set();
  if (existsSync(crmPath)) {
    const crm = readFileSync(crmPath, "utf8");
    for (const match of crm.matchAll(/"(\/_next\/static\/chunks\/[^"?]+\.js)"/g)) {
      chunks.add(match[1]);
    }
  }
  // A dynamic route with no client-reference-manifest has zero client
  // components of its own — the shared runtime is its entire payload.
  const shared = readNextJson("build-manifest.json");
  for (const file of [...shared.rootMainFiles, ...shared.polyfillFiles]) {
    chunks.add(NEXT_URL_PREFIX + file);
  }
  let total = 0;
  for (const chunk of chunks) total += nextFileSize(chunk);
  return total;
}

/**
 * Measure every client route from the current build.
 * @returns {{ route: string, bytes: number, source: "html" | "dynamic" }[]}
 */
function measureAllRoutes() {
  return enumerateClientRoutes().map(({ publicPath, internalPath }) => {
    const htmlBytes = measureHtmlRoute(publicPath);
    return htmlBytes >= 0
      ? { route: publicPath, bytes: htmlBytes, source: "html" }
      : { route: publicPath, bytes: measureDynamicRoute(internalPath), source: "dynamic" };
  });
}

/**
 * Render a per-route table (used by failure reports and --capture).
 * @param {{ route: string, bytes: number, source?: string, budget?: number }[]} rows
 * @returns {string}
 */
function renderTable(rows) {
  const width = Math.max(...rows.map((r) => r.route.length), "Route".length);
  const lines = [`  ${"Route".padEnd(width)}  ${"First Load JS".padStart(14)}  Source`];
  for (const row of rows) {
    lines.push(
      `  ${row.route.padEnd(width)}  ${formatKb(row.bytes).padStart(14)}  ${row.source ?? "-"}`
    );
  }
  return lines.join("\n");
}

const routes = measureAllRoutes();

// ---------------------------------------------------------------------------
// --capture: regenerate config/bundle-budget.json from the current build.
// ---------------------------------------------------------------------------
if (process.argv.includes("--capture")) {
  /** @type {Record<string, number>} */
  const budgetRoutes = {};
  for (const { route, bytes } of routes) {
    // Round UP to the next whole kB: ≤1 kB headroom against cross-runner
    // byte-level noise, while the over-budget check stays strict.
    budgetRoutes[route] = Math.ceil(bytes / 1024) * 1024;
  }
  const nextVersion = JSON.parse(
    readFileSync(join(REPO_ROOT, "node_modules", "next", "package.json"), "utf8")
  ).version;
  const file = {
    $comment:
      "Bundle size budgets (issue #1814) — per-route First Load JS, raw " +
      "uncompressed bytes, measured by scripts/check-bundle-budget.mjs from " +
      "the compiled .next/ output (see that script's header for the " +
      "manifest mechanism). Values ratchet DOWN only: --check fails if a " +
      "route exceeds its budget, if a built route has no entry, if an " +
      "entry's route no longer exists, or if reality dropped >10 kB below " +
      "the recorded budget (re-capture with " +
      "`npm run check:bundle-budget:capture`). Entries are rounded up to " +
      "the next whole kB at capture time.",
    nextVersion,
    capturedAt: new Date().toISOString(),
    routes: budgetRoutes,
  };
  mkdirSync(join(REPO_ROOT, "config"), { recursive: true });
  writeFileSync(BUDGET_FILE, `${JSON.stringify(file, null, 2)}\n`);
  console.log(
    `bundle-budget: captured ${routes.length} routes to ${join("config", "bundle-budget.json")} (Next.js ${nextVersion}).`
  );
  console.log("top 5 by size:");
  console.log(
    renderTable([...routes].sort((a, b) => b.bytes - a.bytes).slice(0, 5))
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --check (default): enforce the budgets. Ratchet-down only — see header.
// ---------------------------------------------------------------------------
if (!existsSync(BUDGET_FILE)) {
  failBuild(
    `${join("config", "bundle-budget.json")} not found. Capture initial budgets ` +
      `with \`npm run check:bundle-budget:capture\` (requires a fresh \`npm run build\`).`
  );
}
const budgetFile = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
/** @type {Record<string, number>} */
const budgets = budgetFile.routes ?? failBuild("budget file is malformed: missing `routes` map.");

const measured = new Map(routes.map((r) => [r.route, r]));

/** @type {{ route: string, bytes: number, problem: string }[]} */
const failures = [];
const newRoutes = routes.filter((r) => !(r.route in budgets));
for (const r of newRoutes) {
  failures.push({ route: r.route, bytes: r.bytes, problem: "no budget entry (new route?)" });
}
const staleEntries = Object.keys(budgets).filter((route) => !measured.has(route));
for (const route of staleEntries) {
  failures.push({ route, bytes: -1, problem: "budget entry for a route the build no longer produces" });
}

/** @type {{ route: string, bytes: number, budget: number, problem: string }[]} */
const overBudget = [];
const staleHigh = [];
for (const r of routes) {
  const budget = budgets[r.route];
  if (budget === undefined) continue; // already reported as new route
  if (r.bytes > budget * (1 + TOLERANCE_FRACTION)) {
    overBudget.push({ ...r, budget });
  } else if (budget - r.bytes > RATCHET_SLACK_BYTES) {
    staleHigh.push({ ...r, budget });
  }
}

if (overBudget.length > 0) {
  console.error(
    `bundle-budget: FAILED — ${overBudget.length}/${routes.length} route(s) exceed their First Load JS budget (issue #1814):`
  );
  const width = Math.max(...overBudget.map((r) => r.route.length));
  for (const r of overBudget.sort((a, b) => b.bytes - b.budget - (a.bytes - a.budget))) {
    console.error(
      `  ${r.route.padEnd(width)}  ${formatKb(r.bytes).padStart(12)} > budget ${formatKb(r.budget).padStart(12)}  (+${formatKb(r.bytes - r.budget)})`
    );
  }
  console.error(
    `\nTrim the route's client imports, or — if the growth is intentional ` +
      `and justified — raise nothing: budgets ratchet downward only. Move ` +
      `heavy modules behind next/dynamic, import them in server components, ` +
      `or slim the shared chunks the route pulls in.`
  );
}
if (staleHigh.length > 0) {
  console.error(
    `bundle-budget: FAILED — ${staleHigh.length} route(s) are >${formatKb(RATCHET_SLACK_BYTES)} UNDER their recorded budget; budgets must ratchet downward:`
  );
  for (const r of staleHigh) {
    console.error(`  ${r.route}  ${formatKb(r.bytes)} vs budget ${formatKb(r.budget)}`);
  }
  console.error(
    `\nThe payload shrank — re-capture so the new lower size becomes the ` +
      `ceiling: \`npm run build && npm run check:bundle-budget:capture\`.`
  );
}
if (failures.length > 0) {
  console.error(
    `bundle-budget: FAILED — budget file out of sync with the build (${failures.length} row(s)):`
  );
  for (const f of failures) {
    console.error(`  ${f.route}  ${f.problem}`);
  }
  console.error(
    `\nEvery client route must have exactly one budget entry. Regenerate ` +
      `with \`npm run build && npm run check:bundle-budget:capture\`.`
  );
}

const failureCount = overBudget.length + staleHigh.length + failures.length;
if (failureCount > 0) {
  console.error(
    `\nbundle-budget: FAILED — ${failureCount} problem(s) across ${routes.length} routes.`
  );
  process.exit(1);
}

const total = routes.reduce((sum, r) => sum + r.bytes, 0);
const heaviest = [...routes].sort((a, b) => b.bytes - a.bytes)[0];
console.log(
  `bundle-budget: OK — ${routes.length} routes within budget ` +
    `(total ${formatKb(total)}, heaviest ${heaviest.route} at ${formatKb(heaviest.bytes)}).`
);
