/**
 * Unit coverage for the CSP allow-list builders (src/lib/security/csp-allowlist.ts).
 *
 * The module ships two runtime policies — TAURI_CSP for the desktop webview and
 * WEB_CSP for the Next.js deployment — and both are assembled from the same
 * three host tables. `tests/csp-audit.test.ts` asserts the two policies agree
 * with each other; nothing exercised the builders themselves, so the host
 * tables, the nonce branch of buildTauriCsp, the NODE_ENV branch of
 * buildWebCsp, and cspHostnames were all unexercised.
 *
 * The invariant that matters most here is issue #1584: no bare `https:` or
 * `wss:` scheme wildcard may appear in connect-src. A regression there silently
 * re-opens the exfiltration path the allow-list exists to close.
 */

import {
  REMOTE_IMAGE_HOSTS,
  REMOTE_FONT_HOSTS,
  REMOTE_CONNECT_HOSTS,
  TAURI_CSP,
  WEB_CSP,
  buildTauriCsp,
  buildWebCsp,
  cspHostnames,
  type RemoteImageHost,
} from "../csp-allowlist";

/** Split a policy string into `directive -> tokens[]`. */
function directives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    out.set(tokens[0], tokens.slice(1));
  }
  return out;
}

const ALL_TABLES: ReadonlyArray<[string, readonly RemoteImageHost[]]> = [
  ["REMOTE_IMAGE_HOSTS", REMOTE_IMAGE_HOSTS],
  ["REMOTE_FONT_HOSTS", REMOTE_FONT_HOSTS],
  ["REMOTE_CONNECT_HOSTS", REMOTE_CONNECT_HOSTS],
];

describe("host allow-list tables", () => {
  it.each(ALL_TABLES)("%s is non-empty", (_name, table) => {
    expect(table.length).toBeGreaterThan(0);
  });

  it.each(ALL_TABLES)(
    "%s entries carry a label and a purpose",
    (_name, table) => {
      for (const host of table) {
        expect(host.label.trim()).not.toBe("");
        expect(host.purpose.trim()).not.toBe("");
      }
    },
  );

  it.each(ALL_TABLES)(
    "%s hostnames are bare hosts, not URLs",
    (_name, table) => {
      for (const host of table) {
        // No scheme, no path, no port, no trailing dot, no whitespace.
        expect(host.hostname).toMatch(/^[a-z0-9.-]+$/);
        expect(host.hostname).toContain(".");
        expect(host.hostname).not.toMatch(/^\./);
        expect(host.hostname).not.toMatch(/\.$/);
      }
    },
  );

  it.each(ALL_TABLES)("%s has no duplicate hostnames", (_name, table) => {
    const seen = table.map((h) => h.hostname);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("keeps the Scryfall image CDNs that card art depends on", () => {
    const hostnames = REMOTE_IMAGE_HOSTS.map((h) => h.hostname);
    expect(hostnames).toContain("cards.scryfall.io");
    // picsum.photos redirects to the Fastly host and CSP does not follow
    // redirects, so both must be listed (#1822).
    expect(hostnames).toContain("picsum.photos");
    expect(hostnames).toContain("fastly.picsum.photos");
  });

  it("keeps the Scryfall API reachable over fetch()", () => {
    expect(REMOTE_CONNECT_HOSTS.map((h) => h.hostname)).toContain(
      "api.scryfall.com",
    );
  });
});

describe("buildTauriCsp", () => {
  it("omits any nonce token when no nonce is supplied", () => {
    const scriptSrc = directives(buildTauriCsp()).get("script-src");
    expect(scriptSrc).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  });

  it("embeds the supplied nonce in script-src", () => {
    const scriptSrc = directives(buildTauriCsp("abc123XYZ")).get("script-src");
    expect(scriptSrc).toEqual([
      "'self'",
      "'nonce-abc123XYZ'",
      "'wasm-unsafe-eval'",
    ]);
  });

  it("treats an empty-string nonce as no nonce", () => {
    // `nonce ? ... : ...` — an empty string is falsy, so the strict variant
    // must come back rather than a broken `'nonce-'` token.
    expect(buildTauriCsp("")).toBe(buildTauriCsp());
    expect(buildTauriCsp("")).not.toContain("'nonce-'");
  });

  it("never allows plain 'unsafe-eval' in scripts", () => {
    const scriptSrc =
      directives(buildTauriCsp("n0nce")).get("script-src") ?? [];
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("locks down the directives that block injection and framing", () => {
    const d = directives(buildTauriCsp());
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("frame-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
    expect(d.get("default-src")).toEqual(["'self'"]);
  });

  it("enumerates every connect host as an explicit https origin", () => {
    const connectSrc = directives(buildTauriCsp()).get("connect-src") ?? [];
    for (const host of REMOTE_CONNECT_HOSTS) {
      expect(connectSrc).toContain(`https://${host.hostname}`);
    }
    expect(connectSrc).toContain("'self'");
  });

  it("allows loopback WebSockets but no wss origin (#1584)", () => {
    const connectSrc = directives(buildTauriCsp()).get("connect-src") ?? [];
    expect(connectSrc).toContain("ws://localhost:*");
    expect(connectSrc).toContain("ws://127.0.0.1:*");
    expect(connectSrc.some((t) => t.startsWith("wss://"))).toBe(false);
  });

  it("carries no bare scheme wildcard in any directive (#1584)", () => {
    for (const tokens of directives(buildTauriCsp("n0nce")).values()) {
      expect(tokens).not.toContain("https:");
      expect(tokens).not.toContain("wss:");
      expect(tokens).not.toContain("*");
    }
  });

  it("lists every image and font host in its own directive", () => {
    const d = directives(buildTauriCsp());
    const imgSrc = d.get("img-src") ?? [];
    const fontSrc = d.get("font-src") ?? [];
    for (const host of REMOTE_IMAGE_HOSTS) {
      expect(imgSrc).toContain(`https://${host.hostname}`);
    }
    for (const host of REMOTE_FONT_HOSTS) {
      expect(fontSrc).toContain(`https://${host.hostname}`);
    }
    // data: URIs back the inline placeholder art and the icon font.
    expect(imgSrc).toContain("data:");
    expect(fontSrc).toContain("data:");
  });

  it("is deterministic for a given nonce", () => {
    expect(buildTauriCsp("same")).toBe(buildTauriCsp("same"));
    expect(buildTauriCsp("one")).not.toBe(buildTauriCsp("two"));
  });
});

describe("cspHostnames", () => {
  it("returns sorted, de-duplicated hostnames", () => {
    const hosts = cspHostnames();
    expect(hosts).toEqual([...hosts].sort());
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("surfaces every connect host baked into TAURI_CSP", () => {
    const hosts = cspHostnames();
    for (const host of REMOTE_CONNECT_HOSTS) {
      expect(hosts).toContain(host.hostname);
    }
  });

  it("never returns a bare scheme token", () => {
    for (const host of cspHostnames()) {
      expect(host).toContain(".");
      expect(host).not.toContain(":");
      expect(host).not.toContain("/");
    }
  });
});

describe("buildWebCsp", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: originalNodeEnv,
      configurable: true,
    });
  });

  function withNodeEnv(value: string): string {
    Object.defineProperty(process.env, "NODE_ENV", {
      value,
      configurable: true,
    });
    return buildWebCsp();
  }

  it("allows 'unsafe-eval' only under NODE_ENV=development", () => {
    // React Refresh evaluates generated code via `new Function`.
    const dev = directives(withNodeEnv("development")).get("script-src") ?? [];
    expect(dev).toContain("'unsafe-eval'");

    const prod = directives(withNodeEnv("production")).get("script-src") ?? [];
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it("allows inline scripts in both modes, for the RSC flight payload", () => {
    // next.config.ts headers() cannot mint per-request nonces, so the App
    // Router's inline `self.__next_f.push(...)` tags need 'unsafe-inline'.
    for (const env of ["development", "production"]) {
      const scriptSrc = directives(withNodeEnv(env)).get("script-src") ?? [];
      expect(scriptSrc).toContain("'unsafe-inline'");
      expect(scriptSrc).toContain("'self'");
    }
  });

  it("mirrors the desktop policy everywhere except script-src", () => {
    const web = directives(withNodeEnv("production"));
    const tauri = directives(TAURI_CSP);
    expect([...web.keys()].sort()).toEqual([...tauri.keys()].sort());
    for (const [name, tokens] of tauri) {
      if (name === "script-src") continue;
      expect(web.get(name)).toEqual(tokens);
    }
  });

  it("carries no bare scheme wildcard in production (#1584)", () => {
    for (const tokens of directives(withNodeEnv("production")).values()) {
      expect(tokens).not.toContain("https:");
      expect(tokens).not.toContain("wss:");
    }
  });
});

describe("shipped policy constants", () => {
  it("TAURI_CSP is a non-empty policy string", () => {
    expect(typeof TAURI_CSP).toBe("string");
    expect(directives(TAURI_CSP).size).toBeGreaterThan(5);
  });

  it("WEB_CSP matches the builder under the current NODE_ENV", () => {
    expect(WEB_CSP).toBe(buildWebCsp());
  });
});
