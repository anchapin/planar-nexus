/**
 * @fileoverview Tests for the token-aware conversation history pruner (issue #1238).
 *
 * Validates the contract spelled out in the issue:
 *   - The latest user message is always retained intact.
 *   - The structured-analysis / system-prompt context (passed as `systemContent`)
 *     is reserved against the budget — pruning never silently drops the system
 *     prompt's worth of context.
 *   - Oldest non-system messages are dropped first until the retained slice
 *     fits within the token budget.
 *   - A 50-message history is reduced to within the configured token budget.
 *   - Backward compatibility: the legacy numeric-second-argument signature
 *     still behaves as a message-count cap.
 */

import { describe, it, expect } from "@jest/globals";
import {
  prepareConversationHistory,
  estimateTokens,
  DEFAULT_CONVERSATION_TOKEN_BUDGET,
  DEFAULT_CONVERSATION_MAX_MESSAGES,
} from "../context-builder";
import type { ChatMessage } from "@/types/chat";

function makeMessages(count: number, filler = "x"): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `m-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      // ~50 chars per turn = ~12-13 tokens at chars/4.
      content: `${i}: ${filler.repeat(50)}`,
      timestamp: new Date(i * 1000),
    });
  }
  return out;
}

describe("estimateTokens", () => {
  it("returns 0 for empty / nullish input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  it("applies the chars/4 heuristic by default", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });

  it("honors a custom charsPerToken override", () => {
    // 100 chars / 5 = 20 tokens.
    expect(estimateTokens("a".repeat(100), 5)).toBe(20);
  });

  it("returns 0 when charsPerToken is non-positive", () => {
    expect(estimateTokens("hello", 0)).toBe(0);
    expect(estimateTokens("hello", -1)).toBe(0);
  });
});

describe("prepareConversationHistory — backward compatibility", () => {
  it("treats a numeric second argument as a message-count cap", () => {
    const messages = makeMessages(20);
    const result = prepareConversationHistory(messages, 5);
    expect(result).toHaveLength(5);
    // Last five messages preserved, in original order.
    expect(result.map((m) => m.content)).toEqual(
      messages.slice(-5).map((m) => m.content),
    );
  });

  it("returns messages unchanged when shorter than the message cap and under budget", () => {
    const messages = makeMessages(3);
    const result = prepareConversationHistory(messages, 10);
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.content)).toEqual(
      messages.map((m) => m.content),
    );
  });

  it("returns an empty array when given no messages", () => {
    expect(prepareConversationHistory([], 10)).toEqual([]);
  });
});

describe("prepareConversationHistory — token budget (issue #1238)", () => {
  it("always retains the latest user message intact", () => {
    // 20 turns of ~200 chars each (~50 tokens each = ~1000 tokens total).
    // With a 100-token budget only the latest message fits.
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({
        id: `m-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `turn-${i} ${"a".repeat(200)}`,
        timestamp: new Date(i * 1000),
      });
    }
    const result = prepareConversationHistory(messages, {
      maxTokens: 100,
      maxMessages: 50,
    });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(messages[messages.length - 1].content);
  });

  it("drops the oldest messages first when over the token budget", () => {
    // 10 turns of ~80 chars each ≈ 200 tokens total (20 tokens each).
    // With a budget of 50 tokens, only the last two turns fit.
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        id: `m-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `turn-${i}: ${"a".repeat(80)}`,
        timestamp: new Date(i * 1000),
      });
    }
    const result = prepareConversationHistory(messages, {
      maxTokens: 50,
      maxMessages: 50,
    });
    // Last turn always retained. Walk backwards, admit only turns that fit.
    // 20 tokens per turn (80/4); 50 budget ⇒ latest turn (20 tokens) + 1 prior
    // turn (40 tokens cumulative), third prior would push to 60 > 50.
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(3);
    // Order preserved.
    for (let i = 1; i < result.length; i++) {
      const a = result[i - 1].content;
      const b = result[i].content;
      const ai = messages.findIndex((m) => m.content === a);
      const bi = messages.findIndex((m) => m.content === b);
      expect(ai).toBeLessThan(bi);
    }
    // Latest message is the tail of the original list.
    expect(result[result.length - 1].content).toBe(
      messages[messages.length - 1].content,
    );
  });

  it("reserves systemContent against the token budget", () => {
    // System prompt equivalent to 30 tokens. 10 user turns of 20 tokens each.
    // Budget = 90 tokens ⇒ 30 (system) + 20 (latest) + 20 (prior) + ... up to
    // the 90 - 30 = 60 token cap, so at most 3 user turns retained.
    const systemContent = "s".repeat(120); // 120/4 = 30 tokens.
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        id: `m-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `turn-${i}: ${"a".repeat(80)}`, // 80/4 = 20 tokens each.
        timestamp: new Date(i * 1000),
      });
    }
    const result = prepareConversationHistory(messages, {
      maxTokens: 90,
      maxMessages: 50,
      systemContent,
    });
    // Validate the budget math.
    const retainedTokens = result.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );
    expect(retainedTokens).toBeLessThanOrEqual(90 - 30);
    expect(result[result.length - 1].content).toBe(
      messages[messages.length - 1].content,
    );
  });

  it("reduces a 50-message history to within the configured token budget", () => {
    // ~400 chars per turn ≈ 100 tokens each ⇒ 50 turns ≈ 5000 tokens.
    // Budget of 1000 tokens forces aggressive pruning.
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push({
        id: `m-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `turn-${i}: ${"a".repeat(400)}`,
        timestamp: new Date(i * 1000),
      });
    }
    const budget = 1_000;
    const result = prepareConversationHistory(messages, {
      maxTokens: budget,
      maxMessages: DEFAULT_CONVERSATION_MAX_MESSAGES,
    });
    expect(result.length).toBeLessThan(50);
    const retainedTokens = result.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );
    expect(retainedTokens).toBeLessThanOrEqual(budget);
    // Latest message preserved.
    expect(result[result.length - 1].content).toBe(
      messages[messages.length - 1].content,
    );
  });

  it("never returns more than maxMessages entries", () => {
    // 200 tiny messages; even though each fits in the budget, the cap bites.
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 200; i++) {
      messages.push({
        id: `m-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `t${i}`,
        timestamp: new Date(i * 1000),
      });
    }
    const result = prepareConversationHistory(messages, {
      maxTokens: DEFAULT_CONVERSATION_TOKEN_BUDGET,
      maxMessages: 20,
    });
    expect(result).toHaveLength(20);
    // Tail preserved.
    expect(result[19].content).toBe(messages[199].content);
  });

  it("returns the input unchanged when under both caps and budget", () => {
    const messages = makeMessages(3);
    const result = prepareConversationHistory(messages, {
      maxTokens: DEFAULT_CONVERSATION_TOKEN_BUDGET,
      maxMessages: DEFAULT_CONVERSATION_MAX_MESSAGES,
    });
    expect(result.map((m) => m.content)).toEqual(
      messages.map((m) => m.content),
    );
  });
});