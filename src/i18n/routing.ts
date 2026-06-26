import { defineRouting } from "next-intl/routing";

/**
 * Locale routing configuration.
 *
 * Planar Nexus currently ships a single locale (`en`). This module is the
 * single source of truth for the supported locales and the default locale so
 * that enabling additional locales (and optional locale-based routing) later
 * only requires editing this file plus adding a new message catalog under
 * `src/messages/`. See `docs/i18n.md` for the full workflow.
 */
export const routing = defineRouting({
  locales: ["en"],
  defaultLocale: "en",
});

export const locales = routing.locales;
export const defaultLocale = routing.defaultLocale;
