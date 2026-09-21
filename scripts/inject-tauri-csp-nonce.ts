/**
 * Issue #1918: inject CSP nonce into Tauri build artifacts.
 *
 * This script runs BEFORE the Tauri build (via `npm run prebuild:tauri` called
 * by `build:tauri` before `beforeBuildCommand`).  It:
 *
 *   1. Generates or validates a per-build `TAURI_CSP_NONCE`.
 *   2. Updates `src-tauri/tauri.conf.json` so the embedded CSP contains the
 *      matching `'nonce-<value>'` token.
 *   3. Patches every `*.html` file under `.next/` — all `<script>` tags
 *      that have no `src` attribute receive `nonce="<value>"` so they are
 *      allowed by the strict Tauri webview CSP.
 *
 * The same nonce is exposed to the frontend at runtime via the
 * `get_csp_nonce` Tauri command registered in `src-tauri/src/lib.rs`, so
 * dynamically-created inline scripts can also carry the correct nonce.
 *
 * Usage (normally invoked by `npm run build:tauri`):
 *   npm run prebuild:tauri
 *
 * Environment:
 *   TAURI_CSP_NONCE  — explicit nonce value; if unset a random one is generated.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ROOT = path.resolve(__dirname, "..");
const TAURI_CONF = path.join(ROOT, "src-tauri", "tauri.conf.json");
const NEXT_DIST = path.join(ROOT, ".next");

function generateNonce(): string {
  return crypto.randomBytes(16).toString("base64url");
}

function loadTauriConf(): Record<string, unknown> {
  const raw = fs.readFileSync(TAURI_CONF, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function saveTauriConf(conf: Record<string, unknown>): void {
  fs.writeFileSync(TAURI_CONF, JSON.stringify(conf, null, 2) + "\n", "utf8");
}

/** Replace the `script-src` token in a CSP string with a nonce variant. */
function cspWithNonce(csp: string, nonce: string): string {
  return csp.replace(
    /script-src\s+'self'\s+'wasm-unsafe-eval'/,
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
  );
}

/** Inject nonce attribute into every inline <script> tag in HTML. */
function injectNonceIntoHtml(html: string, nonce: string): string {
  // Match <script> tags without a src attribute (inline scripts).
  // Handles: <script>...</script> and <script attr="val">...</script>
  return html.replace(
    /(<script(?![^>]*\bsrc=)([^>]*)>)/gi,
    (_match, openTag, attrs) => {
      if (/nonce=/i.test(attrs)) return openTag; // already has nonce
      return openTag.replace(/(?=>|$)/, ` nonce="${nonce}"`);
    },
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const nonce = process.env.TAURI_CSP_NONCE ?? generateNonce();

console.log(`[inject-tauri-csp-nonce] nonce = ${nonce}`);

// 1. Update tauri.conf.json CSP --------------------------------------------

const tauriConf = loadTauriConf();
// Navigate to app.security.csp
const app = tauriConf["app"] as Record<string, unknown>;
const security = app["security"] as Record<string, unknown>;
const csp = security["csp"] as string;
security["csp"] = cspWithNonce(csp, nonce);
console.log(`[inject-tauri-csp-nonce] Updated CSP in tauri.conf.json`);
saveTauriConf(tauriConf);

// 2. Inject nonce into .next/*.html files ----------------------------------

if (fs.existsSync(NEXT_DIST)) {
  const htmlFiles = findHtmlFiles(NEXT_DIST);
  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, "utf8");
    const updated = injectNonceIntoHtml(content, nonce);
    fs.writeFileSync(file, updated, "utf8");
    console.log(`[inject-tauri-csp-nonce] Patched ${path.relative(ROOT, file)}`);
  }
} else {
  console.warn(
    `[inject-tauri-csp-nonce] .next/ not found at ${NEXT_DIST} — skipping HTML injection.`,
    `Run \`npm run build\` first.`,
  );
}

// Write nonce to .next/csp-nonce.txt so the Rust side can read it at runtime.
const nonceFile = path.join(NEXT_DIST, "csp-nonce.txt");
fs.writeFileSync(nonceFile, nonce, "utf8");
console.log(`[inject-tauri-csp-nonce] Wrote nonce to ${path.relative(ROOT, nonceFile)}`);

// Also write a JSON file that csp-allowlist.ts can read at module load time
// (it reads this file synchronously to obtain the nonce when TAURI_CSP_NONCE
// env var is not set — this ensures the test baseline and the prebuild script
// always agree on the same nonce value).
const nonceJsonFile = path.join(ROOT, "src", "lib", "security", "csp-nonce.json");
fs.writeFileSync(nonceJsonFile, JSON.stringify({ nonce }), "utf8");
console.log(`[inject-tauri-csp-nonce] Wrote nonce to ${path.relative(ROOT, nonceJsonFile)}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findHtmlFiles(full));
    } else if (entry.name.endsWith(".html")) {
      results.push(full);
    }
  }
  return results;
}
