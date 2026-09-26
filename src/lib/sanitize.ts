/**
 * Sanitization utilities for AI-generated content.
 * Strips HTML tags, XSS vectors, and other unsafe content from strings and objects.
 */

const DANGEROUS_PROTOCOLS = /^(javascript|vbscript|data):/i;
const DANGEROUS_TAGS = /<script[^>]*>|<\/script>|<!--[\s\S]*?-->|<iframe[^>]*>|<\/iframe>|<object[^>]*>|<\/object>|<embed[^>]*>|<\/embed>|<link[^>]*>|<meta[^>]*>/gi;
const DANGEROUS_ATTRS = /\son\w+\s*=/gi;
const DANGEROUS_ENTITIES = /&(colon|tab|newline|#x0(?:[\da-f]?[\da-f]|[\da-h][\da-f][\da-h])?);?/gi;

function sanitizeString(input: string): string {
  if (!input) return input;

  let result = input;

  result = result.replace(DANGEROUS_TAGS, "");
  result = result.replace(DANGEROUS_ATTRS, " ");
  result = result.replace(DANGEROUS_ENTITIES, " ");
  result = result.replace(/[\x00-\x1F\x7F]/g, "");

  const parts = result.split(/(&nbsp;|<br\s*\/?>)/i);
  result = parts
    .map((part) => {
      if (/^(&nbsp;|<br\s*\/?>)$/i.test(part)) return part;
      return part
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
    })
    .join("");

  result = result.replace(/^\s+|\s+$/g, "");

  const words = result.split(/(\s+)/);
  result = words
    .map((word) => {
      if (!word) return word;
      if (DANGEROUS_PROTOCOLS.test(word)) return "";
      return word;
    })
    .filter(Boolean)
    .join("");

  return result;
}

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

export function sanitizeDeckReview(data: unknown): object {
  if (typeof data !== "object" || data === null) {
    throw new Error("sanitizeDeckReview requires an object");
  }
  return sanitizeObject(data as object);
}

export function sanitizeGeneratedDeckOutput(data: unknown): object {
  if (typeof data !== "object" || data === null) {
    throw new Error("sanitizeGeneratedDeckOutput requires an object");
  }
  return sanitizeObject(data as object);
}
