/**
 * @fileoverview Behavioral tests for the synergy panel's opt-in / loading
 * states in AIDeckAssistant (issue #1813).
 *
 * Acceptance criterion #1: the embedding model loads lazily on first
 * synergy interaction with a VISIBLE loading state. The assistant panel is
 * the synergy UI, so before opt-in it must show the enable affordance, and
 * after opting in it must show a loading indicator (role="status") until
 * the model is ready.
 *
 * `@ai-sdk/react`'s useChat is mocked (the real hook opens a chat
 * connection); the SynergyProvider runs for real against the singleton
 * manager, whose factory resolves to `null` in Jest (no `Worker` global),
 * exercising the provider's inert-by-default path.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom/jest-globals";

import { AIDeckAssistant } from "../ai-deck-assistant";
import { SynergyProvider } from "../synergy-context";
import { _resetEmbeddingWorkerManager } from "@/lib/synergy/embedding-manager";
import type { DeckCard } from "@/lib/card-database";

jest.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: jest.fn(),
    setMessages: jest.fn(),
    status: "ready",
  }),
}));

const DECK: DeckCard[] = [
  {
    id: "card-1",
    name: "Lightning Bolt",
    count: 4,
  } as unknown as DeckCard,
];

function renderAssistant() {
  return render(
    <SynergyProvider deck={DECK}>
      <AIDeckAssistant deck={DECK} onAddCard={jest.fn()} />
    </SynergyProvider>,
  );
}

describe("AIDeckAssistant synergy opt-in UI (issue #1813)", () => {
  beforeEach(() => {
    _resetEmbeddingWorkerManager();
  });

  it("shows an explicit opt-in affordance before any interaction", () => {
    renderAssistant();

    const enableButton = screen.getByTestId("synergy-enable-button");
    expect(enableButton).toBeInTheDocument();
    // Not loading, not calculating — nothing fetched yet.
    expect(screen.queryByTestId("synergy-model-loading")).toBeNull();
  });

  it("shows a visible loading state (role=status) after opting in", async () => {
    renderAssistant();

    await act(async () => {
      fireEvent.click(screen.getByTestId("synergy-enable-button"));
    });

    const loading = screen.getByTestId("synergy-model-loading");
    expect(loading).toHaveAttribute("role", "status");
    expect(loading).toBeInTheDocument();
    expect(screen.queryByTestId("synergy-enable-button")).toBeNull();
  });
});
