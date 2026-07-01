import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { REMOTE_IMAGE_HOSTS } from "./src/lib/security/csp-allowlist";

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

  // Ensure trailing slashes for static hosting
  trailingSlash: true,

  // Set base path for deployment
  basePath: "",

  // Bundle optimization — tree-shake barrel imports so only used components
  // are included in the bundle. Issue #1022.
  experimental: {
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
