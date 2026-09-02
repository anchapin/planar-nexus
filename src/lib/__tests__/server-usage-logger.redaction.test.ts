/**
 * @fileoverview Redaction coverage for UsageLogger (issue #1585).
 *
 * The usage log surfaces error strings (and aggregates errorsByCode). Any
 * caller may hand `markFailure` a raw upstream provider message, so the
 * stored string must be scrubbed (secrets removed, length capped) at the
 * source.
 */

import { describe, it, expect } from "@jest/globals";

import { UsageLogger } from "../server-usage-logger";

describe("UsageLogger.markFailure redaction (issue #1585)", () => {
  it("scrubs bearer tokens and API keys from the stored error string", () => {
    const logger = new UsageLogger("anonymous", "openai", "/chat");
    const leakedKey = "sk-proj-abcdefghij0123456789abcdefghij";

    logger.markFailure(
      `401 Unauthorized: Authorization: Bearer ${leakedKey} rejected`,
      "PROVIDER_REQUEST_FAILED",
    );

    const entry = logger["entry"] as { error?: string; errorCode?: string };
    expect(entry.error).toBeDefined();
    expect(entry.error).not.toContain(leakedKey);
    expect(entry.error).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(entry.error).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/);
    expect(entry.errorCode).toBe("PROVIDER_REQUEST_FAILED");
  });

  it("truncates long upstream messages (embedded body echoes) to 200 chars", () => {
    const logger = new UsageLogger("anonymous", "google", "/chat");

    logger.markFailure(
      `400 invalid body: ${"p".repeat(600)}`,
      "PROVIDER_REQUEST_FAILED",
    );

    const entry = logger["entry"] as { error?: string };
    expect(entry.error).toBeDefined();
    expect(entry.error!.length).toBeLessThanOrEqual(
      200 + "...[truncated]".length,
    );
    expect(entry.error).not.toContain("p".repeat(300));
  });

  it("keeps short, clean failure messages intact", () => {
    const logger = new UsageLogger("anonymous", "openai", "/chat");
    logger.markFailure(
      "Provider not configured on server",
      "PROVIDER_NOT_CONFIGURED",
    );

    const entry = logger["entry"] as { error?: string };
    expect(entry.error).toBe("Provider not configured on server");
  });
});
