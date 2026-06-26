import { getRequestConfig } from "next-intl/server";
import { defaultLocale } from "./routing";
import en from "../messages/en.json";

const dictionaries = {
  en,
} as const;

/**
 * Request-scoped i18n configuration.
 *
 * Because Planar Nexus uses a single global locale (no locale-based URL
 * segments), the locale is resolved directly to `defaultLocale` instead of
 * being read from the pathname. When additional locales are introduced, add
 * them to the `dictionaries` map above and swap the locale resolution for
 * `next-intl`'s locale detection (`next-intl/middleware`) — see `docs/i18n.md`.
 *
 * Static imports are used (rather than `await import(\`../messages/${locale}.json\`)`)
 * because webpack cannot reliably resolve fully-dynamic JSON context modules
 * in all build configurations.
 */
export default getRequestConfig(async () => {
  const locale = defaultLocale;

  return {
    locale,
    messages: dictionaries[locale as keyof typeof dictionaries],
  };
});
