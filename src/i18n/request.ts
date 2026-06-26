import { getRequestConfig } from "next-intl/server";
import { defaultLocale } from "./routing";

/**
 * Request-scoped i18n configuration.
 *
 * Because Planar Nexus uses a single global locale (no locale-based URL
 * segments), the locale is resolved directly to `defaultLocale` instead of
 * being read from the pathname. When additional locales are introduced, swap
 * this for `next-intl`'s locale detection (`next-intl/middleware`) — see
 * `docs/i18n.md`.
 */
export default getRequestConfig(async () => {
  const locale = defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
