/**
 * @fileoverview Tests for the Deck Coach chat panel Cancel button and
 * per-message usage display (issue #1077).
 *
 * Child chat sub-components are mocked so the assertions stay focused on the
 * header's Cancel control and the token-usage/provider telemetry.
 */

import { describe, it, expect, jest, beforeAll } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import { DeckCoachChatPanel } from "../chat-panel";
import type { ChatMessage } from "@/types/chat";

// jsdom does not implement Element.scrollIntoView, which the panel's auto-scroll
// effect calls on mount. Provide a noop so rendering does not throw.
beforeAll(() => {
  Element.prototype.scrollIntoView =
    jest.fn() as unknown as typeof Element.prototype.scrollIntoView;
});

jest.mock("../chat-message-list", () => ({
  ChatMessageList: () => <div data-testid="message-list" />,
}));
jest.mock("../chat-input", () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));
jest.mock("../typing-indicator", () => ({
  TypingIndicator: () => <div data-testid="typing-indicator" />,
}));

function message(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "hi",
    timestamp: new Date(),
    ...partial,
  };
}

describe("DeckCoachChatPanel — Cancel button", () => {
  it("renders an accessible Cancel button while streaming", () => {
    const onCancel = jest.fn();
    render(
      <DeckCoachChatPanel
        messages={[]}
        isLoading
        onSendMessage={() => {}}
        onCancel={onCancel}
      />,
    );
    const cancel = screen.getByRole("button", { name: "Cancel generation" });
    expect(cancel).toBeInTheDocument();
    expect(cancel).toHaveAttribute("aria-label", "Cancel generation");
    expect(cancel.tagName).toBe("BUTTON");
  });

  it("calls onCancel when clicked", () => {
    const onCancel = jest.fn();
    render(
      <DeckCoachChatPanel
        messages={[]}
        isLoading
        onSendMessage={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel generation" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not render a Cancel button when not streaming", () => {
    render(
      <DeckCoachChatPanel
        messages={[]}
        isLoading={false}
        onSendMessage={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel generation" }),
    ).not.toBeInTheDocument();
  });

  it("does not render a Cancel button when no onCancel handler is provided", () => {
    render(
      <DeckCoachChatPanel messages={[]} isLoading onSendMessage={() => {}} />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel generation" }),
    ).not.toBeInTheDocument();
  });
});

describe("DeckCoachChatPanel — token usage & provider display", () => {
  it("shows the total token count and provider for the last assistant message", () => {
    render(
      <DeckCoachChatPanel
        messages={[
          message({
            content: "Hello",
            provider: "openai",
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          }),
        ]}
        onSendMessage={() => {}}
      />,
    );
    expect(screen.getByText("15 tok")).toBeInTheDocument();
    expect(screen.getByText("openai")).toBeInTheDocument();
  });

  it("hides the token badge when usage is absent or zero", () => {
    render(
      <DeckCoachChatPanel
        messages={[message({ content: "Hello", provider: "openai" })]}
        onSendMessage={() => {}}
      />,
    );
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });
});
