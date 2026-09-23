/**
 * MSW Playwright Integration Utilities
 *
 * This module provides utilities for using MSW (Mock Service Worker) patterns
 * in Playwright E2E tests. Issue #2070.
 *
 * Note: MSW intercepts browser fetch requests. Server-side calls made by
 * Next.js API routes cannot be intercepted by browser-based MSW. For E2E tests
 * of AI streaming, use page.route() to mock the /api/ai-proxy endpoint,
 * or mock at the external provider level if testing direct AI SDK usage.
 */

import { type Page } from "@playwright/test";
import { aiHandlers, externalAIHandlers } from "./handlers";

/**
 * External AI provider base URLs
 */
export const AI_PROVIDER_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta2",
} as const;

/**
 * Supported AI providers
 */
export type SupportedProvider = "openai" | "anthropic" | "google";

/**
 * Streaming response templates for external AI providers
 * These match the provider-native SSE formats expected by Vercel AI SDK
 */
export const STREAMING_RESPONSES: Record<
  SupportedProvider,
  { chunks: string[]; contentType: string }
> = {
  openai: {
    chunks: [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"This card synergizes well with your deck."}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":" It provides efficient mana acceleration."}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"finish_reason":"stop"}\n\n',
    ],
    contentType: "text/event-stream; charset=utf-8",
  },
  anthropic: {
    chunks: [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":50,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"This card synergizes well with your deck."}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" It provides efficient mana acceleration."}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ],
    contentType: "text/event-stream; charset=utf-8",
  },
  google: {
    chunks: [
      'data: {"candidates":[{"content":{"parts":[{"text":""}]},"finishReason":"STOP"}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"This card synergizes well with your deck."}]},"finishReason":"STOP"}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" It provides efficient mana acceleration."}]},"finishReason":"STOP"}]}\n\n',
    ],
    contentType: "text/event-stream; charset=utf-8",
  },
};

/**
 * Set up external AI provider streaming mocks in a Playwright page
 *
 * This uses page.route() to mock the external AI provider endpoints.
 * While this doesn't use MSW's service worker mechanism, it provides
 * the same streaming response format that MSW handlers would return.
 *
 * @param page - Playwright page object
 * @param provider - AI provider to mock ('openai', 'anthropic', 'google')
 */
export async function mockExternalAIProvider(
  page: Page,
  provider: SupportedProvider,
): Promise<void> {
  const config = STREAMING_RESPONSES[provider];
  const baseUrl = AI_PROVIDER_URLS[provider];

  let urlPattern: string;
  switch (provider) {
    case "openai":
      urlPattern = `${baseUrl}/chat/completions`;
      break;
    case "anthropic":
      urlPattern = `${baseUrl}/messages`;
      break;
    case "google":
      urlPattern = `${baseUrl}/models/*/generateContent`;
      break;
  }

  await page.route(`**${urlPattern}**`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await route.fulfill({
      status: 200,
      contentType: config.contentType,
      body: Buffer.from(config.chunks.join("")),
    });
  });
}

/**
 * Re-export AI handlers for convenience
 */
export { aiHandlers, externalAIHandlers };
