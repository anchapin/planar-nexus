/**
 * Single source of truth for the security allow-list (issue #1273).
 *
 * This module is the canonical reference for which external origins Planar
 * Nexus is permitted to load resources from. It is consumed by:
 *
 *   1. `src-tauri/tauri.conf.json` — the desktop webview Content Security
 *      Policy (the only browser-level hardening we have in the Tauri build).
 *   2. `next.config.ts` — the Next.js Image Optimizer `remotePatterns`.
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
 * Hosts reachable via `fetch()` / `XMLHttpRequest` / WebSocket from the
 * webview. CSP `connect-src` is built from this plus `'self'` and
 * `wss://*.peerjs.com`. Wildcards (`https:`, `wss:`) are deliberately
 * **not** used here — see "Why an explicit list" above.
 *
 * PeerJS itself runs a public broker at `0.peerjs.com`; the wildcard
 * `wss://*.peerjs.com` is required because the broker hostname rotates
 * geographically and the PeerJS client computes the broker URL at
 * runtime.
 */
export const REMOTE_CONNECT_HOSTS: readonly RemoteImageHost[] = [
  {
    label: "PeerJS broker (WebSocket)",
    hostname: "0.peerjs.com",
    purpose: "Default PeerJS signaling broker; rotates per region.",
  },
  {
    label: "Scryfall API",
    hostname: "api.scryfall.com",
    purpose: "Card database lookups and oracle-text search.",
  },
  {
    label: "Google Generative AI",
    hostname: "generativelanguage.googleapis.com",
    purpose: "AI coach / AI opponent inference endpoint.",
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
 *   - `connect-src 'self' wss://*.peerjs.com https:` is a deliberate
 *     exception: PeerJS rotates brokers and the AI coach calls HTTPS
 *     endpoints that are also pinned in `REMOTE_CONNECT_HOSTS`. The
 *     `https:` here is the **floor** of HTTPS connectivity — it does not
 *     relax `script-src` or `img-src`, so a script-injection cannot
 *     exfiltrate via these channels any more than the same-origin
 *     renderer already can.
 */
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
  "font-src 'self' data: https://fonts.gstatic.com",
  // WebRTC signaling uses the PeerJS broker; the AI coach calls the
  // Google Generative AI API and the Scryfall API. All other HTTPS
  // calls happen from the same Origin as well. The `https:` token is
  // a deliberate broad fallback for unknown AI endpoints added in
  // future minor releases — each new endpoint must still be added to
  // REMOTE_CONNECT_HOSTS above for documentation.
  "connect-src 'self' wss://*.peerjs.com https:",
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
 */
export function cspHostnames(): string[] {
  const out = new Set<string>();
  const re = /https?:\/\/([a-z0-9.*-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(TAURI_CSP)) !== null) {
    const host = m[1];
    // Skip the bare scheme token — `https:` with no host is not a hostname.
    if (host && host.includes(".")) out.add(host);
  }
  return [...out].sort();
}