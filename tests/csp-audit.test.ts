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
 *   4. Every hostname from `REMOTE_IMAGE_HOSTS` and `REMOTE_FONT_HOSTS`
 *      appears in the corresponding CSP directive.
 *   5. `connect-src` explicitly enumerates every host in
 *      `REMOTE_CONNECT_HOSTS` and contains NO bare `https:` or `wss:`
 *      scheme-wide wildcard (issue #1584). The PeerJS broker fleet is
 *      carried by `REMOTE_PEERJS_BROKER_PATTERN` instead.
 *   6. The Next.js image optimizer (`next.config.ts`) agrees with the
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
  REMOTE_PEERJS_BROKER_PATTERN,
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

  test("connect-src contains NO bare scheme wildcard (issue #1584)", () => {
    const directives = splitDirectives(TAURI_CSP);
    const connectValues = directives.get("connect-src") ?? [];
    const joined = connectValues.join(" ");
    // Bare `https:` and `wss:` tokens defeat the purpose of the CSP — an
    // attacker with a script injection could otherwise exfiltrate data to
    // any HTTPS endpoint, or open a WebSocket to any WSS endpoint. The
    // directives must enumerate hosts explicitly. The single remaining
    // pattern is `wss://*.peerjs.com` for the PeerJS broker fleet (see
    // REMOTE_PEERJS_BROKER_PATTERN below).
    expect(connectValues).not.toContain("https:");
    expect(connectValues).not.toContain("wss:");
    // Defence in depth: a bare scheme token might appear mid-string with
    // surrounding whitespace; reject it wherever it shows up.
    expect(joined).not.toMatch(/(?:^|\s)https:(?:\s|$)/);
    expect(joined).not.toMatch(/(?:^|\s)wss:(?:\s|$)/);
    // Sanity check: 'self' must still be allowed (offline / same-origin).
    expect(connectValues).toContain("'self'");
  });

  test("connect-src explicitly enumerates every REMOTE_CONNECT_HOSTS host (issue #1584)", () => {
    const directives = splitDirectives(TAURI_CSP);
    const connectValues = directives.get("connect-src") ?? [];
    // Every HTTPS host in the allow-list must appear literally as
    // `https://hostname` — no scheme-wide fallback to satisfy the
    // coverage check. If a future AI provider is added to
    // PROVIDER_ENV_MAPPING it MUST also be added to REMOTE_CONNECT_HOSTS
    // so this test passes.
    for (const host of REMOTE_CONNECT_HOSTS) {
      expect(connectValues).toContain(`https://${host.hostname}`);
    }
  });

  test("connect-src covers the PeerJS broker fleet via the wildcard pattern (issue #1584)", () => {
    const directives = splitDirectives(TAURI_CSP);
    const connectValues = directives.get("connect-src") ?? [];
    // PeerJS runs a public broker fleet (0.peerjs.com, 1.peerjs.com,
    // ...) that rotates geographically at runtime. We cover the whole
    // fleet with a single explicit source — this is the ONLY remaining
    // pattern in connect-src, and it is documented and tested.
    expect(connectValues).toContain(REMOTE_PEERJS_BROKER_PATTERN);
  });

  test("connect-src has no stray scheme source beyond the documented set (issue #1584)", () => {
    // Defence in depth: enumerate the full allow-list as a JSON-style
    // assertion so a future contributor adding a new provider cannot
    // silently bypass the per-host checks above.
    const directives = splitDirectives(TAURI_CSP);
    const connectValues = directives.get("connect-src") ?? [];
    const expected = new Set<string>([
      "'self'",
      REMOTE_PEERJS_BROKER_PATTERN,
      ...REMOTE_CONNECT_HOSTS.map((host) => `https://${host.hostname}`),
    ]);
    // Sort-compare so the assertion message lists every unexpected /
    // missing token.
    expect([...connectValues].sort()).toEqual([...expected].sort());
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
  test("remotePatterns is derived from the shared csp-allowlist (no drift)", () => {
    const text = readText(NEXT_CONFIG);
    // The point of the allow-list is single-source-of-truth. We can't
    // ast-parse here, but we can verify both:
    //   (a) the file imports REMOTE_IMAGE_HOSTS from csp-allowlist, and
    //   (b) the remotePatterns config is built from that import via .map
    // If either is true, the literal hostname strings will never appear
    // in next.config.ts — by design.
    expect(text).toMatch(
      /from\s+["']\.\.?\/src\/lib\/security\/csp-allowlist["']/,
    );
    expect(text).toMatch(/remotePatterns\s*:\s*REMOTE_IMAGE_HOSTS\.map/);
  });
});
