import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { REMOTE_IMAGE_HOSTS, WEB_CSP } from "./src/lib/security/csp-allowlist";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Static export for client-side only deployment
  // Note: Disabled for now - causes issues with use client pages
  // output: 'export',

  // Configure image optimization
  images: {
    unoptimized: true,
    // Single source of truth: this list must stay in sync with the
    // `img-src` directive in `src-tauri/tauri.conf.json`'s CSP
    // (issue #1273). The `csp-audit` regression test asserts they
    // match exactly.
    remotePatterns: REMOTE_IMAGE_HOSTS.map((host) => ({
      protocol: "https",
      hostname: host.hostname,
      port: "",
      pathname: "/**",
    })),
  },

  // Security headers for the web deployment (issue #1822). The desktop
  // shell gets its CSP from src-tauri/tauri.conf.json; these headers
  // cover the browser-served app. The CSP value is derived from the
  // shared csp-allowlist module, extending the #1273 single-source-of-
  // truth sync to three consumers: the Tauri CSP, the image optimizer
  // remotePatterns, and the web CSP (tests/csp-audit.test.ts).
  //
  // Clickjacking is mitigated via the CSP `frame-ancestors 'none'`
  // directive rather than a redundant `X-Frame-Options: DENY` header —
  // frame-ancestors supersedes X-Frame-Options in every CSP-capable
  // browser and is already asserted by the audit test, so the header
  // is deliberately omitted.
  //
  // HSTS max-age is 180 days: long enough to pin https for returning
  // visitors, modest enough to keep the TLS-misconfiguration recovery
  // window short for a newly shipped web deployment. Ignored by
  // browsers over plain http, so local dev is unaffected.
  async headers() {
    return [
      {
        // All routes — pages and API handlers alike.
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: WEB_CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
        ],
      },
    ];
  },

  // Ensure trailing slashes for static hosting
  trailingSlash: true,

  // Set base path for deployment
  basePath: "",

  // Bundle optimization — tree-shake barrel imports so only used components
  // are included in the bundle. Issue #1022.
  experimental: {
    // Next 16.3 type-checks via the TypeScript CLI (`typescript/bin/tsc`)
    // by default, but the `typescript` dependency is the
    // `@typescript/typescript6` alias (#1608), which ships `bin/tsc6` only —
    // so `next build` reports typescript as missing and fails. The alias
    // *does* expose the compiler API (lib/typescript.js → @typescript/old),
    // so use the API checker instead.
    useTypeScriptCli: false,
    optimizePackageImports: [
      "@radix-ui/react-accordion",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-avatar",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-collapsible",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-menubar",
      "@radix-ui/react-popover",
      "@radix-ui/react-progress",
      "@radix-ui/react-radio-group",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slider",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-tooltip",
      "lucide-react",
    ],
  },
};

export default withNextIntl(nextConfig);
