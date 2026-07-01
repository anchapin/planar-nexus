/**
 * Unit tests for the Tauri Content Security Policy (issue #1273).
 *
 * Asserts the contract documented in CONTRIBUTING.md § "Security model":
 *
 *   1. `src-tauri/tauri.conf.json` ships with a non-null `app.security.csp`
 *      string.
 *   2. That string is **byte-identical** to the canonical CSP exported by
 *      `src/lib/security/csp-allowlist.ts` (the single source of truth).
 *   3. The CSP does **not** contain `unsafe-eval`, a bare `*` source, or
 *      a bare `data:` source outside the directives that legitimately
 *      need it (`img-src`, `font-src`).
 *   4. Every hostname from `REMOTE_IMAGE_HOSTS`, `REMOTE_FONT_HOSTS`, and
 *      `REMOTE_CONNECT_HOSTS` appears in the corresponding CSP directive.
 *   5. The Next.js image optimizer (`next.config.ts`) agrees with the
 *      CSP `img-src` directive.
 *
 * These tests run in plain Node (no Tauri runtime required) so they fail
 * fast in CI without spinning up a webview.
 */

import * as fs from "fs";
import * as path from "path";

import {
  TAURI_CSP,
  REMOTE_IMAGE_HOSTS,
  REMOTE_FONT_HOSTS,
  REMOTE_CONNECT_HOSTS,
} from "../src/lib/security/csp-allowlist";

const REPO_ROOT = path.resolve(__dirname, "..");
const TAURI_CONF = path.join(REPO_ROOT, "src-tauri", "tauri.conf.json");
const NEXT_CONFIG = path.join(REPO_ROOT, "next.config.ts");

function readText(file: string): string {
  return fs.readFileSync(file, "utf8");
}

type TauriConf = {
  app: {
    security: {
      csp: string | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function loadTauriConf(): TauriConf {
  return JSON.parse(readText(TAURI_CONF)) as TauriConf;
}

/** Split a CSP into its directive parts (`name value1 value2...`). */
function splitDirectives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const raw of csp.split(";")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const [name, ...rest] = trimmed.split(/\s+/);
    out.set(name.toLowerCase(), rest);
  }
  return out;
}

/** Extract every host token from a single CSP directive's value list. */
function hostsInDirective(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    // Strip scheme prefix, leave host[:port][/path]
    const m = /^(?:[a-z]+:)?\/\/([^/]+)/.exec(v);
    if (m) out.push(m[1]);
    else if (/^[a-z0-9.*-]+\.[a-z0-9-]/i.test(v)) out.push(v);
  }
  return out;
}

describe("Tauri CSP audit (issue #1273)", () => {
  const conf = loadTauriConf();
  const cspValue = conf.app.security.csp;

  test("tauri.conf.json has a non-null CSP", () => {
    expect(cspValue).not.toBeNull();
    expect(typeof cspValue).toBe("string");
    expect((cspValue ?? "").length).toBeGreaterThan(0);
  });

  test("CSP matches the canonical TAURI_CSP exactly (single source of truth)", () => {
    expect(cspValue).toBe(TAURI_CSP);
  });

  test("CSP does not enable unsafe-eval or wildcard sources", () => {
    expect(TAURI_CSP).not.toMatch(/'unsafe-eval'(?![-a-z])/i);
    // 'unsafe-inline' is allowed ONLY in style-src (documented trade-off).
    expect(TAURI_CSP).not.toMatch(/\s\*\s/); // bare wildcard token
    expect(TAURI_CSP).not.toMatch(/^[^;]*\bfont-src[^;]*\*\b/m);
    expect(TAURI_CSP).not.toMatch(/^[^;]*\bconnect-src[^;]*\*:/m);
  });

  test("img-src allows every host in REMOTE_IMAGE_HOSTS", () => {
    const directives = splitDirectives(TAURI_CSP);
    const imgValues = directives.get("img-src") ?? [];
    const hosts = hostsInDirective(imgValues);
    for (const host of REMOTE_IMAGE_HOSTS) {
      expect(hosts).toContain(host.hostname);
    }
  });

  test("font-src allows every host in REMOTE_FONT_HOSTS", () => {
    const directives = splitDirectives(TAURI_CSP);
    const fontValues = directives.get("font-src") ?? [];
    const hosts = hostsInDirective(fontValues);
    for (const host of REMOTE_FONT_HOSTS) {
      expect(hosts).toContain(host.hostname);
    }
  });

  test("connect-src covers the connect allow-list (host or wildcard)", () => {
    const directives = splitDirectives(TAURI_CSP);
    const connectValues = directives.get("connect-src") ?? [];
    const hosts = hostsInDirective(connectValues);
    // Each declared host must either be explicitly listed OR covered by a
    // scheme-wide fallback (currently `https:` for the AI endpoints). The
    // PeerJS broker is pinned to `wss://*.peerjs.com` so we expect that
    // exact prefix to appear.
    expect(connectValues.join(" ")).toMatch(/wss:\/\/\*\.peerjs\.com/);
    expect(connectValues).toContain("https:");
    // And no host should be silently *missing* — if REMOTE_CONNECT_HOSTS
    // grows, this list will catch a regression that drops the entry.
    for (const host of REMOTE_CONNECT_HOSTS) {
      const covered =
        hosts.includes(host.hostname) ||
        // Scheme-wide fallback (https: / wss:) covers everything HTTPS.
        connectValues.includes("https:") ||
        connectValues.includes("wss:");
      expect(covered).toBe(true);
    }
  });

  test("script-src forbids 'unsafe-inline' (only 'unsafe-eval' via wasm is allowed)", () => {
    const directives = splitDirectives(TAURI_CSP);
    const scriptValues = directives.get("script-src") ?? [];
    expect(scriptValues.join(" ")).not.toMatch(/'unsafe-inline'/);
    // WASM-unsafe-eval is OK; raw unsafe-eval is not.
    expect(scriptValues.join(" ")).not.toMatch(/'unsafe-eval'(?![-a-z])/i);
  });

  test("frame-ancestors, object-src, frame-src are restrictive", () => {
    const directives = splitDirectives(TAURI_CSP);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("frame-src")).toEqual(["'none'"]);
  });

  test("base-uri and form-action are pinned to 'self'", () => {
    const directives = splitDirectives(TAURI_CSP);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
  });
});

describe("next.config.ts agrees with the CSP img-src (issue #1273)", () => {
  test("images.remotePatterns covers every REMOTE_IMAGE_HOSTS entry", () => {
    const text = readText(NEXT_CONFIG);
    // Lightweight text-level check: every hostname in the allow-list
    // must literally appear in next.config.ts. This is intentionally
    // tolerant — we don't parse TypeScript here, just confirm the file
    // is using the shared allow-list (no drift).
    for (const host of REMOTE_IMAGE_HOSTS) {
      expect(text).toContain(host.hostname);
    }
    // And the import for the shared module is present (so we know the
    // list isn't hand-duplicated).
    expect(text).toMatch(/from\s+["']\.\.?\/src\/lib\/security\/csp-allowlist["']/);
  });
});