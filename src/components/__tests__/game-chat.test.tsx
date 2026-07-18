/**
 * Render-layer safety test for the game chat panel (issue #1428).
 *
 * The transport layer (P2PGameConnection / MeshGameConnection) now caps and
 * sanitizes chat on both send and receive. This test pins the ADDITIONAL
 * render-time defense in `game-chat.tsx` — the layer a future change could
 * accidentally weaken. It asserts that a malicious message (raw HTML,
 * javascript: link, control chars, an oversized blob) reaches the DOM only
 * as safe, escaped plain text, with no executable element materialised and
 * no renderer overflow.
 *
 * `game-chat.tsx` renders message content via JSX interpolation of
 * `sanitizeCardText(message.content, 1_000)` (no `dangerouslySetInnerHTML`,
 * no `react-markdown`), so React auto-escapes the residual HTML chars. These
 * tests verify that contract end-to-end through the real component.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { GameChat, type ChatMessage } from "../game-chat";

// Radix ScrollArea reads ResizeObserver during layout; jsdom lacks it.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
}

const baseProps = {
  currentPlayerId: "me",
  currentPlayerName: "Me",
  onSendMessage: jest.fn(),
};

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m1",
    playerId: "other",
    playerName: "Peer",
    content: "hello",
    timestamp: 0,
    ...overrides,
  };
}

describe("GameChat render-layer sanitization (#1428)", () => {
  it("renders an HTML-injection payload as escaped text, not as an element", () => {
    const payload = "<script>alert(1)</script><img src=x onerror=alert(1)>";
    render(
      <GameChat {...baseProps} messages={[message({ content: payload })]} />,
    );

    // No executable element is materialised in the DOM.
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    // The payload is visible only as escaped text (the literal tag chars).
    const log = screen.getByRole("log");
    expect(log.textContent).toContain("script");
    expect(log.textContent).toContain("alert(1)");
  });

  it("renders a javascript: URL / event-handler payload as inert text", () => {
    const payload = '<a href="javascript:alert(1)">click</a>';
    render(
      <GameChat {...baseProps} messages={[message({ content: payload })]} />,
    );

    // No anchor element is materialised from the peer-controlled string.
    expect(document.querySelector("a")).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("javascript");
  });

  it("renders a control-character payload without the control bytes", () => {
    const payload = "hi\x00\x07\x1Bworld";
    render(
      <GameChat {...baseProps} messages={[message({ content: payload })]} />,
    );

    const text = screen.getByRole("log").textContent ?? "";
    // sanitizeCardText strips control chars at render; the visible text has
    // the printable remainder.
    expect(text).not.toContain("\x00");
    expect(text).not.toContain("\x07");
    expect(text).toContain("hi");
    expect(text).toContain("world");
  });

  it("caps an oversized render payload so the renderer does not overflow", () => {
    // The render layer caps at 1_000 chars via sanitizeCardText(content, 1_000).
    const oversized = "A".repeat(5_000);
    render(
      <GameChat {...baseProps} messages={[message({ content: oversized })]} />,
    );

    const text = screen.getByRole("log").textContent ?? "";
    // Truncated well below the 5_000-char input and flagged as truncated.
    expect(text.length).toBeLessThan(5_000);
    expect(text).toContain("truncated");
  });

  it("renders a normal chat message unchanged", () => {
    render(
      <GameChat
        {...baseProps}
        messages={[message({ content: "gg, nice play!" })]}
      />,
    );
    expect(screen.getByRole("log").textContent).toContain("gg, nice play!");
  });
});
