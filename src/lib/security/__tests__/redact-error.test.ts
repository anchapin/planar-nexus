/**
 * @fileoverview Tests for error redaction utilities (issue #1585).
 *
 * Covers the secret-shaped patterns mandated by the issue —
 * /(Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{35}|Authorization:[^;\n]+)/gi
 * (`sk-` character class widened to `[\w-]` per issue #1873 so bare
 * `sk-proj-...` keys without a Bearer wrapper are caught)
 * — plus the extensions (sk-ant- Anthropic keys, x-api-key headers, key
 * query params, literal env secret scrubbing), the 200-char body-excerpt
 * truncation, and the stable AUTH/PROVIDER/NETWORK/INTERNAL classification
 * that backs the client-facing error codes.
 *
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

import { describe, it, expect, afterEach } from "@jest/globals";

import {
  MAX_REDACTED_MESSAGE_LENGTH,
  REDACTED,
  classifyProxyError,
  newCorrelationId,
  redactErrorMessage,
  redactSecrets,
  redactText,
  scrubDecklist,
  scrubDigestedContext,
  scrubMessages,
  toSafeClientError,
  truncateForSafety,
} from "../redact-error";

// A realistic 40-char Google key (AIza + 35 url-safe chars).
const GOOGLE_KEY = `AIza${"a".repeat(25)}-_-${"b".repeat(7)}`;
// Realistic OpenAI-style key: sk- + 30 alphanumerics.
const OPENAI_KEY = `sk-${"0123456789abcdef".repeat(2)}`; // sk- + 32 chars
// Realistic Anthropic key.
const ANTHROPIC_KEY = `sk-ant-api03-${"c".repeat(30)}`;
// A random bearer token.
const BEARER_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sig-part-_";

const ORIGINAL_ENV: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined) {
  if (!(name in ORIGINAL_ENV)) {
    ORIGINAL_ENV[name] = process.env[name];
  }
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    setEnv(name, value);
  }
});

describe("redactSecrets", () => {
  it("strips Bearer tokens from message text", () => {
    const input = `401 Unauthorized: request had Authorization: Bearer ${BEARER_TOKEN} for org proj_1`;
    const output = redactSecrets(input);
    expect(output).not.toContain(BEARER_TOKEN);
    expect(output).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/);
    // Layered redaction: the Bearer token is stripped first, then the
    // enclosing Authorization header value is redacted wholesale.
    expect(output).toContain("Authorization: [REDACTED]");
  });

  it("strips OpenAI-style sk- keys (20+ alphanumerics)", () => {
    const output = redactSecrets(`Incorrect API key provided: ${OPENAI_KEY}`);
    expect(output).not.toContain(OPENAI_KEY);
    // Widened to [\w-] per issue #1873 so bare sk-proj-* keys are caught.
    expect(output).not.toMatch(/sk-[\w-]{20,}/);
  });

  it("strips bare OpenAI sk-proj-* keys (no Bearer wrapper, issue #1873)", () => {
    // Regression for issue #1873: the structural sk- regex previously
    // used [A-Za-z0-9]{20,}, which misses the hyphen in `sk-proj-...`
    // prefixes and lets bare keys (no `Bearer` wrapper, no
    // `Authorization:` header) leak through. Widened to [\w-]{20,}.
    const leakedKey = "sk-proj-abcdefghij0123456789abcdefghij";
    const output = redactSecrets(
      `provider rejected key ${leakedKey} for org proj_42`,
    );
    expect(output).not.toContain(leakedKey);
    expect(output).not.toMatch(/sk-[\w-]{20,}/);
  });

  it("strips Anthropic sk-ant- keys", () => {
    const output = redactSecrets(`invalid x-api-key: ${ANTHROPIC_KEY}`);
    expect(output).not.toContain(ANTHROPIC_KEY);
    expect(output).not.toMatch(/sk-ant-[A-Za-z0-9-]{16,}/);
  });

  it("strips Google AIza keys", () => {
    const output = redactSecrets(
      `GET https://generativelanguage.googleapis.com/v1/models?key=${GOOGLE_KEY} failed`,
    );
    expect(output).not.toContain(GOOGLE_KEY);
    expect(output).not.toMatch(/AIza[A-Za-z0-9_-]{35}/);
  });

  it("strips Authorization / x-api-key header echoes, including JSON-serialized forms", () => {
    const plain = `request headers: Authorization: Bearer ${OPENAI_KEY}; x-api-key: ${ANTHROPIC_KEY}`;
    const json = `headers {"Authorization":"Bearer ${OPENAI_KEY}","x-api-key":"${ANTHROPIC_KEY}"}`;

    for (const input of [plain, json]) {
      const output = redactSecrets(input);
      expect(output).not.toContain(OPENAI_KEY);
      expect(output).not.toContain(ANTHROPIC_KEY);
    }
  });

  it("strips key-bearing query parameters", () => {
    const output = redactSecrets(
      "failed: https://api.example.com/v1/chat?api_key=supersecret123456&key=anothersecret89&foo=bar",
    );
    expect(output).not.toContain("supersecret123456");
    expect(output).not.toContain("anothersecret89");
    expect(output).toContain("foo=bar");
  });

  it("is case-insensitive for header and bearer forms", () => {
    const output = redactSecrets(
      `authorization: bearer ${BEARER_TOKEN.toLowerCase()}`,
    );
    expect(output).not.toContain(BEARER_TOKEN.toLowerCase());
  });

  it("scrubs the literal configured provider secret values from the environment", () => {
    setEnv("OPENAI_API_KEY", "weird-custom-format-not-matching-any-pattern");
    const output = redactSecrets(
      "server rejected key weird-custom-format-not-matching-any-pattern",
    );
    expect(output).not.toContain("weird-custom-format");
    expect(output).toContain(REDACTED);
  });

  it("leaves ordinary text untouched", () => {
    const input = "connect ECONNREFUSED 93.184.216.34:443 (TCP)";
    expect(redactSecrets(input)).toBe(input);
  });

  it("handles nullish and empty input", () => {
    expect(redactSecrets(undefined)).toBe("");
    expect(redactSecrets(null)).toBe("");
    expect(redactSecrets("")).toBe("");
  });
});

describe("truncateForSafety / redactText", () => {
  it("truncates embedded request bodies beyond 200 chars", () => {
    const promptEcho = `400 Invalid value: ${"p".repeat(600)}`;
    const output = redactText(promptEcho);
    expect(output.length).toBeLessThanOrEqual(
      MAX_REDACTED_MESSAGE_LENGTH + "...[truncated]".length,
    );
    expect(output).not.toContain("p".repeat(300));
    expect(output.endsWith("...[truncated]")).toBe(true);
  });

  it("keeps short safe text verbatim", () => {
    expect(truncateForSafety("short and safe")).toBe("short and safe");
  });

  it("respects a custom max length", () => {
    expect(truncateForSafety("abcdef", 3)).toBe("abc...[truncated]");
  });
});

describe("redactErrorMessage", () => {
  it("serializes Error objects with name and redacts key material", () => {
    const error = new Error(
      `401 Unauthorized: Bearer ${BEARER_TOKEN} rejected`,
    );
    const output = redactErrorMessage(error);
    expect(output).toContain("Error:");
    expect(output).not.toContain(BEARER_TOKEN);
  });

  it("serializes non-Error thrown values", () => {
    expect(redactErrorMessage("plain string")).toBe("plain string");
    expect(redactErrorMessage({ status: 500 })).toBe('{"status":500}');
    expect(redactErrorMessage(42)).toBe("42");
  });

  it("truncates long messages to the safety cap", () => {
    const output = redactErrorMessage(new Error("x".repeat(1000)));
    expect(output.length).toBeLessThanOrEqual(
      MAX_REDACTED_MESSAGE_LENGTH + "...[truncated]".length,
    );
  });
});

describe("classifyProxyError", () => {
  it("classifies upstream 401/403 as AUTH", () => {
    expect(
      classifyProxyError(
        Object.assign(new Error("401 Unauthorized"), { status: 401 }),
      ),
    ).toBe("AUTH");
    expect(
      classifyProxyError(
        Object.assign(new Error("Forbidden"), { statusCode: 403 }),
      ),
    ).toBe("AUTH");
    expect(
      classifyProxyError(Object.assign(new Error("nope"), { httpStatus: 401 })),
    ).toBe("AUTH");
  });

  it("classifies other upstream 4xx/5xx as PROVIDER", () => {
    expect(
      classifyProxyError(
        Object.assign(new Error("400 Bad Request"), { statusCode: 400 }),
      ),
    ).toBe("PROVIDER");
    expect(
      classifyProxyError(
        Object.assign(new Error("upstream exploded"), { status: 503 }),
      ),
    ).toBe("PROVIDER");
  });

  it("classifies network failures as NETWORK", () => {
    expect(classifyProxyError(new Error("fetch failed"))).toBe("NETWORK");
    expect(
      classifyProxyError(new Error("connect ECONNREFUSED 1.2.3.4:443")),
    ).toBe("NETWORK");
    expect(
      classifyProxyError(
        Object.assign(new Error("request failed"), {
          cause: { code: "ENOTFOUND" },
        }),
      ),
    ).toBe("NETWORK");
    expect(
      classifyProxyError(new Error("getaddrinfo ENOTFOUND api.openai.com")),
    ).toBe("NETWORK");
  });

  it("falls back to message heuristics when no status property exists", () => {
    expect(classifyProxyError(new Error("Incorrect API key provided"))).toBe(
      "AUTH",
    );
    expect(classifyProxyError(new Error("401 Unauthorized: bad key"))).toBe(
      "AUTH",
    );
    expect(
      classifyProxyError(new Error("400 - messages[0].content is invalid")),
    ).toBe("PROVIDER");
  });

  it("classifies unknown errors as INTERNAL", () => {
    expect(classifyProxyError(new Error("sdk exploded"))).toBe("INTERNAL");
    expect(classifyProxyError(undefined)).toBe("INTERNAL");
    expect(classifyProxyError("boom")).toBe("INTERNAL");
    expect(classifyProxyError(42)).toBe("INTERNAL");
  });
});

describe("toSafeClientError", () => {
  it("maps each class to a generic message and a stable errorCode", () => {
    expect(
      toSafeClientError(Object.assign(new Error("401"), { status: 401 })),
    ).toEqual({
      error: "Provider authentication failed",
      errorCode: "INVALID_API_KEY",
      errorClass: "AUTH",
    });
    expect(
      toSafeClientError(Object.assign(new Error("400"), { status: 400 })),
    ).toEqual({
      error: "Provider request failed",
      errorCode: "PROVIDER_REQUEST_FAILED",
      errorClass: "PROVIDER",
    });
    expect(toSafeClientError(new Error("fetch failed"))).toEqual({
      error: "Provider network error",
      errorCode: "NETWORK_ERROR",
      errorClass: "NETWORK",
    });
    expect(toSafeClientError(new Error("sdk exploded"))).toEqual({
      error: "Internal server error",
      errorCode: "INTERNAL_ERROR",
      errorClass: "INTERNAL",
    });
  });
});

describe("newCorrelationId", () => {
  it("returns a non-empty, reasonably unique id", () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

// ----------------------------------------------------------------------------
// User-supplied prompt payload scrubbing (issue #1916)
// ----------------------------------------------------------------------------

describe("scrubDecklist", () => {
  it("scrubs decklist lines from error message", () => {
    const input =
      "400 Bad Request: Decklist:\n1 Lightning Bolt\n4 Brainstorm\n3 Counterspell\n\nOther text";
    const output = scrubDecklist(input);
    expect(output).not.toContain("1 Lightning Bolt");
    expect(output).not.toContain("4 Brainstorm");
    expect(output).not.toContain("3 Counterspell");
    expect(output).toContain("Decklist:");
    expect(output).toContain("Other text");
  });

  it("returns text unchanged when no Decklist: marker present", () => {
    const input = "No decklist here, just some text";
    expect(scrubDecklist(input)).toBe(input);
  });

  it("reports card count in redaction token", () => {
    const input = "Decklist:\n1 Bolt\n4 Brainstorm";
    const output = scrubDecklist(input);
    expect(output).toContain("[redacted-decklist");
    expect(output).toContain("2 cards");
  });

  it("leaves ordinary text untouched", () => {
    expect(scrubDecklist("just some regular text")).toBe(
      "just some regular text",
    );
  });
});

describe("scrubMessages", () => {
  it("scrubs messages[].content from error message", () => {
    const input =
      '{"messages":[{"role":"user","content":"What is my best play?"},{"role":"assistant","content":"Cast Lightning Bolt."}]}';
    const output = scrubMessages(input);
    expect(output).not.toContain("What is my best play?");
    expect(output).not.toContain("Cast Lightning Bolt.");
    expect(output).toContain("[redacted-content");
  });

  it("reports character count of redacted content", () => {
    const input =
      '{"messages":[{"role":"user","content":"What is my best play?"}]}';
    const output = scrubMessages(input);
    expect(output).toContain("[redacted-content 21 chars]");
  });

  it("returns text unchanged when no message content present", () => {
    const input = '{"other":"json","without":"messages"}';
    expect(scrubMessages(input)).toBe(input);
  });

  it("handles empty content values", () => {
    const input = '{"messages":[{"role":"user","content":""}]}';
    const output = scrubMessages(input);
    expect(output).toBe(input);
  });
});

describe("scrubDigestedContext", () => {
  it("scrubs digestedContext JSON from error message", () => {
    const input =
      '{"digestedContext":{"cards":[{"name":"Lightning Bolt"}],"totalCards":1}}';
    const output = scrubDigestedContext(input);
    expect(output).not.toContain("Lightning Bolt");
    expect(output).not.toContain("digestedContext");
    expect(output).toContain("[redacted-context]");
  });

  it("returns text unchanged when no digestedContext present", () => {
    const input = '{"normal":"json","data":"here"}';
    expect(scrubDigestedContext(input)).toBe(input);
  });

  it("handles nested digestedContext JSON", () => {
    const input = '{"outer":{"digestedContext":{"inner":{"cards":[]}}}}';
    const output = scrubDigestedContext(input);
    expect(output).not.toContain("digestedContext");
    expect(output).toContain("[redacted-context]");
  });
});

describe("redactSecrets (prompt payload integration, issue #1916)", () => {
  it("scrubs decklist lines as part of the standard pipeline", () => {
    const input = "Decklist:\n1 Lightning Bolt\n4 Brainstorm";
    const output = redactSecrets(input);
    expect(output).not.toContain("Lightning Bolt");
    expect(output).not.toContain("Brainstorm");
    expect(output).toContain("[redacted-decklist");
  });

  it("scrubs messages[].content as part of the standard pipeline", () => {
    const input =
      '{"messages":[{"role":"user","content":"Should I mulligan?"}]}';
    const output = redactSecrets(input);
    expect(output).not.toContain("Should I mulligan?");
    expect(output).toContain("[redacted-content");
  });

  it("scrubs digestedContext JSON as part of the standard pipeline", () => {
    const input =
      '{"digestedContext":{"cards":[{"name":"Terramorphic Expanse"}]}}';
    const output = redactSecrets(input);
    expect(output).not.toContain("Terramorphic Expanse");
    expect(output).toContain("[redacted-context]");
  });

  it("reports character count of redacted content", () => {
    const input =
      '{"messages":[{"role":"user","content":"What is my best play?"}]}';
    const output = scrubMessages(input);
    expect(output).toContain("[redacted-content 21 chars]");
  });

  it("a decklist never reaches the server log line", () => {
    const errorMessage =
      "400 Bad Request\nDecklist:\n4 Brainstorm\n3 Ponder\n2 Lightning Bolt\nuser question: is this good?";
    const output = redactSecrets(errorMessage);
    expect(output).not.toContain("Brainstorm");
    expect(output).not.toContain("Ponder");
    expect(output).not.toContain("Lightning Bolt");
    expect(output).toContain("400 Bad Request");
    expect(output).toContain("user question:");
  });
});
