/**
 * Single source of truth for the security allow-list (issue #1273).
 *
 * This module is the canonical reference for which external origins Planar
 * Nexus is permitted to load resources from. It is consumed by:
 *
 *   1. `src-tauri/tauri.conf.json` — the desktop webview Content Security
 *      Policy (the only browser-level hardening we have in the Tauri build).
 *   2. `next.config.ts` — the Next.js Image Optimizer `remotePatterns`
 *      and (issue #1822) the web deployment's `Content-Security-Policy`
 *      emitted via `headers()`.
 *   3. `src/app/layout.tsx` — any `<link rel="preconnect">` / `<link
 *      rel="stylesheet">` to external font or asset hosts.
 *
 * **Why a single source of truth?** Before this module existed the same
 * list of hosts was hard-coded in `tauri.conf.json`, `next.config.ts`, and
 * `layout.tsx`. Adding a new external host required a manual, error-prone
 * update of three different files, and the CSP could silently drift out of
 * sync with the image optimizer (or vice versa). Centralising the list
 * means a regression test can confirm that `tauri.conf.json`'s `csp`,
 * `next.config.ts`'s `images.remotePatterns`, and the preconnect hints all
 * point at the same set of hosts — and that any new host is reviewed
 * through `CONTRIBUTING.md § "Security model"`.
 *
 * **Why an explicit list and not `https:`?** A wildcard `https:` source in
 * `img-src` or `connect-src` would defeat the purpose of a CSP: an
 * attacker who lands a script injection (via card oracle text, AI coach
 * responses, peer chat, etc.) could then exfiltrate data to any HTTPS
 * endpoint. Listing only the hosts the app actually needs turns that
 * exfiltration into a CSP violation that the webview blocks at the network
 * layer.
 */

export type RemoteImageHost = {
  /** Display label for docs / error messages. */
  readonly label: string;
  /** Hostname exactly as it appears in the URL (no scheme, no path). */
  readonly hostname: string;
  /** Why this host is in the allow-list. */
  readonly purpose: string;
};

/**
 * Hosts the Next.js `<Image>` component (and any plain `<img>` referencing
 * the Scryfall / Unsplash / Picsum / Placehold CDNs) is allowed to load
 * from. This list must match `src-tauri/tauri.conf.json`'s `csp` `img-src`
 * directive exactly.
 */
export const REMOTE_IMAGE_HOSTS: readonly RemoteImageHost[] = [
  {
    label: "Scryfall card images (front)",
    hostname: "cards.scryfall.io",
    purpose: "Card artwork and oracle-text renders from the Scryfall API.",
  },
  {
    label: "Scryfall card images (legacy)",
    hostname: "img.scryfall.com",
    purpose: "Legacy Scryfall image CDN retained for older deck imports.",
  },
  {
    label: "Unsplash",
    hostname: "images.unsplash.com",
    purpose: "Procedural art fallbacks and landing-page photography.",
  },
  {
    label: "Picsum",
    hostname: "picsum.photos",
    purpose: "Random placeholder images in deck-builder and demo flows.",
  },
  {
    label: "Placeholder",
    hostname: "placehold.co",
    purpose: "Deterministic placeholder art for missing card images.",
  },
] as const;

/**
 * Hosts referenced from `src/app/layout.tsx` for fonts. Listed
 * separately because the CSP directive that consumes them
 * (`font-src`, `style-src`) is different from `img-src`.
 */
export const REMOTE_FONT_HOSTS: readonly RemoteImageHost[] = [
  {
    label: "Google Fonts CSS",
    hostname: "fonts.googleapis.com",
    purpose: "Stylesheet for the Inter and Space Grotesk web fonts.",
  },
  {
    label: "Google Fonts files",
    hostname: "fonts.gstatic.com",
    purpose: "Actual web-font files referenced by the Google Fonts CSS.",
  },
] as const;

/**
 * Hosts reachable via `fetch()` / `XMLHttpRequest` from the webview over
 * HTTPS. Each entry must appear **literally** as `https://hostname` in
 * the `connect-src` directive. Adding a host here without surfacing it
 * in the runtime CSP would be caught by `tests/csp-audit.test.ts`
 * (issue #1584). No WSS wildcard exists anymore: the PeerJS broker
 * pattern was removed together with the orphaned `peerjs` dependency
 * (2026-09 cleanup) — multiplayer uses direct WebRTC DataChannels with
 * TURN relay, so no broker host is reachable.
 *
 * Mirror the hostnames here with the `baseURL` defaults in
 * `src/lib/env.ts` (`API_ENDPOINTS.*`) and the AI provider list in
 * `src/ai/providers/types.ts` (`AIProvider`). New AI providers added in
 * `PROVIDER_ENV_MAPPING` must also add their default `baseURL` hostname
 * here so the CSP keeps pace.
 */
export const REMOTE_CONNECT_HOSTS: readonly RemoteImageHost[] = [
  {
    label: "Scryfall API",
    hostname: "api.scryfall.com",
    purpose: "Card database lookups and oracle-text search.",
  },
  {
    label: "Google Generative AI",
    hostname: "generativelanguage.googleapis.com",
    purpose: "AI coach / AI opponent inference endpoint (Google provider).",
  },
  {
    label: "OpenAI API",
    hostname: "api.openai.com",
    purpose: "AI coach / AI opponent inference endpoint (OpenAI provider).",
  },
  {
    label: "Anthropic API",
    hostname: "api.anthropic.com",
    purpose: "AI coach / AI opponent inference endpoint (Anthropic provider).",
  },
  {
    label: "Z.ai API",
    hostname: "api.z-ai.com",
    purpose:
      "AI coach / AI opponent inference endpoint (Z.ai provider, default baseURL).",
  },
] as const;

/**
 * The full Content Security Policy applied by the Tauri webview
 * (`src-tauri/tauri.conf.json` → `app.security.csp`). Kept in code so
 * the `csp-audit` regression test can parse it and assert it contains
 * every host in the allow-list above — and does **not** contain `*`,
 * `data:` (except where explicitly allowed), `unsafe-eval`, or any
 * other wildcard.
 *
 * Trade-offs:
 *
 *   - `style-src 'unsafe-inline'` is required by Next.js + Tailwind for
 *     streaming SSR style injection. Removing it requires a nonce-based
 *     strategy that is not yet implemented upstream in Next.js 15.
 *     See: https://github.com/vercel/next.js/issues/47822
 *
 *   - `script-src 'wasm-unsafe-eval'` allows the WASM backend used by
 *     `@huggingface/transformers` (the offline ML side of the AI coach).
 *     Plain `'unsafe-eval'` is **not** enabled.
 *
 *   - `connect-src` is now an explicit allow-list (issue #1584). The
 *     HTTPS sources are derived from {@link REMOTE_CONNECT_HOSTS}. The
 *     previous `https:` scheme-wide fallback has been removed because it
 *     would let a script-injection exfiltrate data to any HTTPS
 *     endpoint, defeating the purpose of a CSP. The `wss://*.peerjs.com`
 *     broker pattern was removed with the orphaned `peerjs` dependency
 *     (2026-09 cleanup): multiplayer uses direct WebRTC DataChannels +
 *     TURN relay and never opens a broker WebSocket.
 */

/**
 * Build the `connect-src` directive value from the allow-lists above.
 * Derived at module load time so the runtime CSP and the regression
 * test cannot drift out of sync (issue #1584).
 */
function buildConnectSrc(): string {
  const sources = [
    "'self'",
    ...REMOTE_CONNECT_HOSTS.map((host) => `https://${host.hostname}`),
  ];
  return sources.join(" ");
}

export const TAURI_CSP = [
  "default-src 'self'",
  // No `'unsafe-inline'` for scripts: Next.js 15 streams chunks as
  // <script src="..."> tags, and the Tauri webview is built with a
  // strict nonce-free CSP. If a future feature requires inline scripts
  // it must use a nonce injected by a Tauri command.
  "script-src 'self' 'wasm-unsafe-eval'",
  // `'unsafe-inline'` here is required by Next.js streaming SSR styles
  // and by Tailwind's runtime style injection. Documented in
  // CONTRIBUTING.md § "Security model".
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https://cards.scryfall.io https://img.scryfall.com https://images.unsplash.com https://picsum.photos https://placehold.co",
  "font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com",
  // HTTPS endpoints are enumerated from REMOTE_CONNECT_HOSTS; no WSS
  // wildcard (the PeerJS broker pattern was removed with the orphaned
  // dependency — multiplayer is direct WebRTC DataChannels + TURN).
  // See issue #1584 — no bare `https:` or `wss:` scheme wildcards.
  `connect-src ${buildConnectSrc()}`,
  // MSW runs in the browser as a service-worker shim that compiles
  // handlers into blob: URLs at runtime.
  "worker-src 'self' blob:",
  // WebRTC peer streams + board-state replay viewer use MediaStream
  // and Blob URLs.
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join("; ");

/**
 * Extract every hostname that appears in `TAURI_CSP`. Used by the
 * `csp-audit` regression test to assert that the runtime CSP matches the
 * static allow-list.
 *
 * Recognises both `http(s)` and `ws(s)` scheme tokens so the
 * `wss://*.peerjs.com` broker pattern (issue #1584) surfaces in the
 * returned set.
 */
export function cspHostnames(): string[] {
  const out = new Set<string>();
  const re = /(?:https?|wss?):\/\/([a-z0-9.*-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(TAURI_CSP)) !== null) {
    const host = m[1];
    // Skip the bare scheme token — `https:` with no host is not a hostname.
    if (host && host.includes(".")) out.add(host);
  }
  return [...out].sort();
}

/**
 * Web-deployment Content Security Policy (issue #1822).
 *
 * The desktop shell ships its CSP via `src-tauri/tauri.conf.json`; until
 * #1822 the plain-web deployment shipped none at all — no header-level
 * XSS mitigation for an app that renders untrusted text (Scryfall oracle
 * text, imported deck names, peer chat) and holds provider API keys in
 * localStorage. `next.config.ts` `headers()` serves the policy built
 * below (plus the standard security headers) on every route.
 *
 * The policy is derived from the exact same allow-lists as
 * {@link TAURI_CSP}, and `tests/csp-audit.test.ts` asserts that it
 * mirrors TAURI_CSP directive-for-directive with a single, documented
 * exception: `script-src`.
 *
 * Why the exception? On the desktop, Tauri rewrites the served HTML and
 * CSP to nonce-tag inline scripts before the webview sees them, so
 * TAURI_CSP can afford `script-src 'self' 'wasm-unsafe-eval'`. The web
 * deployment has no such layer, and `next.config.ts` `headers()` cannot
 * mint per-request nonces (that requires middleware, deliberately out
 * of scope for #1822). Next.js App Router streams its RSC/flight
 * payload as inline `<script>self.__next_f.push(...)</script>` tags,
 * so the shipped web policy must additionally allow `'unsafe-inline'`
 * for scripts or hydration breaks. Everything else — including the ban
 * on plain `'unsafe-eval'` in the production policy — matches the
 * desktop policy exactly.
 */

/**
 * Build the `img-src` directive value shared by both deployments.
 * Derived from {@link REMOTE_IMAGE_HOSTS}; `tests/csp-audit.test.ts`
 * asserts the result matches the `img-src` tokens of {@link TAURI_CSP}.
 */
function buildImgSrc(): string {
  return [
    "'self'",
    "data:",
    ...REMOTE_IMAGE_HOSTS.map((host) => `https://${host.hostname}`),
  ].join(" ");
}

/**
 * Build the `font-src` directive value shared by both deployments.
 * Derived from {@link REMOTE_FONT_HOSTS}; `tests/csp-audit.test.ts`
 * asserts the result matches the `font-src` tokens of {@link TAURI_CSP}.
 */
function buildFontSrc(): string {
  return [
    "'self'",
    "data:",
    ...REMOTE_FONT_HOSTS.map((host) => `https://${host.hostname}`),
  ].join(" ");
}

/**
 * Assemble the web CSP. Split out from the {@link WEB_CSP} constant so
 * the audit test can import the builder and reason about the shipped
 * (non-development) shape deterministically.
 */
export function buildWebCsp(): string {
  const scriptSrc =
    process.env.NODE_ENV === "development"
      ? // Dev-only addition: React Refresh (the Fast Refresh runtime)
        // evaluates generated code via `new Function`, which CSP counts
        // as `'unsafe-eval'`. Without it `npm run dev` and the Playwright
        // suite (which boots the dev server) break. Never present in a
        // production build — enforced by the audit test.
        "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'";

  return [
    "default-src 'self'",
    scriptSrc,
    // Mirrors TAURI_CSP: `'unsafe-inline'` is required by Next.js
    // streaming SSR styles and Tailwind's runtime style injection.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src ${buildImgSrc()}`,
    `font-src ${buildFontSrc()}`,
    // Same explicit allow-list as the desktop policy (issue #1584):
    // no bare `https:` / `wss:` scheme wildcards.
    `connect-src ${buildConnectSrc()}`,
    // MSW's service-worker shim compiles handlers into blob: URLs.
    "worker-src 'self' blob:",
    // WebRTC peer streams + board-state replay viewer (Blob/MediaStream).
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ].join("; ");
}

/** The CSP served by `next.config.ts` `headers()` on every web route. */
export const WEB_CSP: string = buildWebCsp();
