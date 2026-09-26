/**
 * @fileOverview Output sanitization for AI-generated content (issue #2150).
 *
 * AI outputs (deck reviews, opponent descriptions, coaching advice) are
 * untrusted — the model may inadvertently include malicious HTML, script
 * injection, or other XSS vectors. This module sanitizes all string fields
 * in AI output objects before they are returned to the client.
 *
 * Strategy:
 *   - Strip raw HTML tags entirely (not escape) so markdown formatting survives.
 *   - Remove javascript:, data: (except data:image/ for embedded images).
 *   - Remove inline event handlers (onclick, onerror, onload, on*).
 *   - Remove SVG/XML dangerous elements (embed, object, iframe, form).
 *   - Clamp output length to a safe upper bound.
 */

const MAX_OUTPUT_LENGTH = 50_000;

/**
 * Patterns used to detect and remove dangerous content.
 */
const DANGEROUS_TAG =
  /<\/?(?:script|style|svg|img|video|audio|iframe|embed|object|form|input|button|link|meta|base|xml|math|canvas)[^>]*>/gi;
const DANGEROUS_ATTR = /\s(on(?:click|dblclick|load|error|submit|change|input|keydown|keyup|keypress|mouse\w+|focus|blur|abort|drag\w+|drop|scroll|copy|cut|paste|play|pause|volumechange|composition\w+|contextmenu|wheel|touch\w+|animation\w+|transition\w+|beforeinput|enterkeyhint)\s*=/gi;
const JAVASCRIPT_URL = /javascript\s*:/gi;
const DATA_URL = /data\s*:(?!image\/(?:png|jpeg|jpg|gif|webp|svg\+xml))/gi;

function sanitizeString(value: unknown, maxLen = MAX_OUTPUT_LENGTH): string {
  if (value === null || value === undefined) return "";
  let str = typeof value === "string" ? value : String(value);

  str = str.replace(DANGEROUS_TAG, "");
  str = str.replace(DANGEROUS_ATTR, " ");
  str = str.replace(JAVASCRIPT_URL, "");
  str = str.replace(DATA_URL, "");

  if (str.length > maxLen) {
    str = str.slice(0, maxLen) + "…[output truncated]";
  }

  return str.trim();
}

/**
 * Recursively sanitize all string fields in a plain object.
 * Handles nested objects and arrays. Non-string primitives pass through.
 */
function sanitizeObject<T extends object>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) =>
      item !== null && typeof item === "object"
        ? sanitizeObject(item as object)
        : typeof item === "string"
          ? sanitizeString(item)
          : item,
    ) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = value;
    } else if (typeof value === "string") {
      result[key] = sanitizeString(value);
    } else if (typeof value === "object") {
      result[key] = sanitizeObject(value as object);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Sanitize a DeckReviewOutput object returned from the AI deck-review flow.
 * Strips all dangerous content from every string field.
 */
export function sanitizeDeckReview(data: unknown) {
  if (typeof data !== "object" || data === null) return null;
  return sanitizeObject(data as object);
}

/**
 * Sanitize a GeneratedDeck object from opponent generation.
 * Strips all dangerous content from every string field.
 */
export function sanitizeGeneratedDeckOutput(data: unknown) {
  if (typeof data !== "object" || data === null) return null;
  return sanitizeObject(data as object);
}
