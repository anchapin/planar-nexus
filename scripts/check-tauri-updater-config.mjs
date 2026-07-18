#!/usr/bin/env node
/**
 * Tauri 2 Updater Configuration Guard — Issue #1430
 *
 * Defence-in-depth CI gate that prevents the Tauri 2 updater from ever
 * shipping with the documented MITM-vulnerable empty-pubkey default
 * (`plugins.updater.active === true && plugins.updater.pubkey === ""`).
 *
 * The Jest suite `tests/updater-wiring.test.ts` (#1403) already asserts the
 * positive contracts (active updater has a real minisign pubkey, HTTPS
 * endpoint, capability grant, createUpdaterArtifacts flag, and on-disk .pub
 * drift). This script is the cheaper, runtime-free complement: it runs in
 * plain Node (no Jest, no Tauri toolchain) so it can gate `prebuild` and a
 * dedicated CI job without waiting for the full unit-test suite.
 *
 * Contract (all must hold):
 *
 *   A. If `plugins.updater` is absent OR `plugins.updater.active === false`,
 *      the updater is considered disabled and the guard passes. Both states
 *      are safe: an absent block means the plugin is unregistered, and an
 *      explicit `active: false` documents the disabled intent.
 *
 *   B. If `plugins.updater.active === true`, ALL of the following must hold:
 *        1. `pubkey` is a non-empty string (this is the core #1430 fix —
 *           an empty pubkey disables signature verification, which is the
 *           MITM-vulnerable default).
 *        2. `pubkey` matches the minisign-public-key wire format that
 *           `tauri signer generate` emits (base64 of
 *           `untrusted comment: minisign public key: <HEXID>\n<key-b64>`).
 *           This stops a placeholder like `"TODO"` or `"placeholder"` from
 *           satisfying the non-empty check.
 *        3. `endpoints` contains at least one URL that is HTTPS and ends
 *           in `.json` (the Tauri updater manifest shape). This prevents
 *           a future contributor from flipping the endpoint to plain HTTP
 *           or to an arbitrary non-manifest URL.
 *
 *   C. If `bundle.createUpdaterArtifacts === true`, the updater MUST be
 *      active with a valid pubkey (contract B). Otherwise `tauri build`
 *      emits per-installer `.sig` files that reference a manifest the
 *      runtime cannot validate — a quieter version of the same drift.
 *
 * Usage:
 *   node scripts/check-tauri-updater-config.mjs            # reads repo default
 *   node scripts/check-tauri-updater-config.mjs <path>     # reads alternate config
 *
 * Exits 0 on pass, 1 on violation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONF = path.join(REPO_ROOT, "src-tauri", "tauri.conf.json");

// Base64 prefix of the canonical minisign public-key comment line:
//   "untrusted comment: minisign public key: <HEXID>\n"
// Encoded as a single string for the JSON-embedded form Tauri 2 accepts.
const MINISIGN_PUBKEY_PREFIX =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6";

/**
 * Evaluate the updater configuration contract.
 *
 * @param {unknown} config - Parsed tauri.conf.json contents.
 * @returns {{ ok: true } | { ok: false; errors: string[] }}
 */
export function checkUpdaterConfig(config) {
  /** @type {string[]} */
  const errors = [];

  if (config === null || typeof config !== "object") {
    errors.push("tauri.conf.json: root must be a JSON object");
    return { ok: false, errors };
  }

  const root = /** @type {Record<string, unknown>} */ (config);
  const plugins = /** @type {Record<string, unknown> | undefined} */ (
    root.plugins
  );
  const updater = /** @type {Record<string, unknown> | undefined} */ (
    plugins?.updater
  );

  const bundle = /** @type {Record<string, unknown> | undefined} */ (
    root.bundle
  );
  const createUpdaterArtifacts = bundle?.createUpdaterArtifacts;

  // --- Contract A: absent or explicitly disabled is safe. -------------------
  //
  // The Tauri 2 docs treat an absent `plugins.updater` block as "the
  // updater plugin is not registered, do nothing". `active: false` is the
  // explicit-disabled form. Both are documented safe states under #1430
  // option B — UNLESS `bundle.createUpdaterArtifacts` is true, in which
  // case `tauri build` would emit per-installer .sig files that reference
  // a manifest the runtime cannot fetch. We surface that as contract C
  // so the inconsistency does not pass silently.
  const isUpdaterActive =
    updater !== undefined && updater.active === true;

  if (createUpdaterArtifacts === true && !isUpdaterActive) {
    errors.push(
      "bundle.createUpdaterArtifacts is true but the updater is not active " +
        "(either plugins.updater is absent or plugins.updater.active is not true). " +
        "Set plugins.updater.active to true with a valid pubkey + endpoint, or set " +
        "bundle.createUpdaterArtifacts to false; otherwise tauri build emits .sig " +
        "files that reference a manifest the runtime will not fetch.",
    );
    // Continue evaluating the rest so a single run surfaces every problem.
  }

  if (updater === undefined) {
    // Updater plugin config block is absent — safe under #1430 option B
    // (contract C failures, if any, have already been recorded above).
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }
  const active = updater.active;
  if (active === false) {
    // Updater is explicitly disabled — safe (same caveat as above for
    // contract C).
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  // From here on we treat the block as active. We accept `active: true`
  // (the canonical form) but also fail closed on any non-boolean truthy
  // value to prevent `active: "yes"` or similar shape drift.
  if (active !== true) {
    errors.push(
      `plugins.updater.active must be a boolean; got ${JSON.stringify(active)}. ` +
        "Set it to false (or remove the updater block) to disable the updater cleanly.",
    );
    return { ok: false, errors };
  }

  // --- Contract B.1: non-empty pubkey. -------------------------------------
  const pubkey = typeof updater.pubkey === "string" ? updater.pubkey : "";
  if (pubkey.length === 0) {
    errors.push(
      "plugins.updater.pubkey is empty while plugins.updater.active === true. " +
        "An empty pubkey disables signature verification — this is the MITM-vulnerable " +
        "default documented in issue #1430. Either set a real minisign public key " +
        "(see docs/RELEASE_RUNBOOK.md) or set plugins.updater.active to false.",
    );
  }

  // --- Contract B.2: minisign wire format. ---------------------------------
  if (pubkey.length > 0 && !pubkey.startsWith(MINISIGN_PUBKEY_PREFIX)) {
    errors.push(
      "plugins.updater.pubkey does not match the minisign public-key format " +
        `(expected base64 prefix "${MINISIGN_PUBKEY_PREFIX}"). Run ` +
        "`tauri signer generate -p <password>` and copy the .pub contents; see " +
        "docs/RELEASE_RUNBOOK.md.",
    );
  }

  // --- Contract B.3: at least one HTTPS JSON endpoint. ---------------------
  const endpoints = Array.isArray(updater.endpoints) ? updater.endpoints : [];
  if (endpoints.length === 0) {
    errors.push(
      "plugins.updater.endpoints is empty while plugins.updater.active === true. " +
        "Provide at least one HTTPS URL pointing at the Tauri 2 updater manifest " +
        "(e.g. https://github.com/<org>/<repo>/releases/latest/download/latest.json).",
    );
  } else {
    const httpsJsonEndpoints = endpoints.filter(
      (url) => typeof url === "string" && /^https:\/\//.test(url) && /\.json$/i.test(url),
    );
    if (httpsJsonEndpoints.length === 0) {
      errors.push(
        `plugins.updater.endpoints has ${endpoints.length} entr${endpoints.length === 1 ? "y" : "ies"} ` +
          "but none is an HTTPS URL ending in .json. All endpoints must be TLS-pinned " +
          "manifest URLs; found: " +
          endpoints.map((u) => JSON.stringify(u)).join(", ") +
          ".",
      );
    }
  }

  // --- Contract C: createUpdaterArtifacts requires an active, signed updater.
  //
  // The actual "is the updater misconfigured?" evaluation happens in
  // contract B above; this short block just re-states the inconsistency
  // in plain language so a contributor reading the CI log can map the
  // failure back to the createUpdaterArtifacts flag without having to
  // cross-reference contract B's errors.
  if (createUpdaterArtifacts === true && errors.length > 0) {
    errors.push(
      "bundle.createUpdaterArtifacts is true so tauri build will emit .sig files, " +
        "but the updater plugin is misconfigured (see above). Either fix the updater " +
        "config or set bundle.createUpdaterArtifacts to false.",
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @param {string} confPath
 * @returns {number} exit code (0 pass, 1 fail)
 */
function run(confPath) {
  if (!fs.existsSync(confPath)) {
    console.error(
      `[check-tauri-updater-config] FAIL: config not found at ${confPath}`,
    );
    return 1;
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(confPath, "utf8"));
  } catch (err) {
    console.error(
      `[check-tauri-updater-config] FAIL: could not parse JSON at ${confPath}: ${err}`,
    );
    return 1;
  }

  const result = checkUpdaterConfig(parsed);
  if (result.ok) {
    console.log(
      `[check-tauri-updater-config] PASS: ${confPath} satisfies the #1430 updater contract.`,
    );
    return 0;
  }

  console.error(
    `[check-tauri-updater-config] FAIL: ${confPath} violates the #1430 updater contract:`,
  );
  for (const e of result.errors) {
    console.error(`  - ${e}`);
  }
  console.error(
    "See https://github.com/anchapin/planar-nexus/issues/1430 and " +
      "docs/RELEASE_RUNBOOK.md for the signing-key + endpoint setup.",
  );
  return 1;
}

// Run only when invoked directly, not when imported by a test.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  const confArg = process.argv[2];
  const confPath = confArg
    ? path.isAbsolute(confArg)
      ? confArg
      : path.resolve(process.cwd(), confArg)
    : DEFAULT_CONF;
  process.exit(run(confPath));
}
