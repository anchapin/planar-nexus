/**
 * @fileoverview Component tests for the AI coach chat panel (issue #1787).
 *
 * The v1.7 conversational coach surfaces chat through this panel. The hook
 * (`useGameChat` from @/hooks/use-game-chat) has its own suite; these tests
 * exercise the COMPONENT contract only, driving the hook through a
 * `jest.mock` fixture:
 *
 *   1. message send — typing + submit calls the hook's `sendMessage` with the
 *      typed text and clears the input,
 *   2. streaming tokens — progressively growing assistant messages render
 *      incrementally, with the thinking indicator while in flight,
 *   3. error/fallback — an `error` status renders the graceful-degradation
 *      "Coming Soon" placeholder (issue #1009) which can be dismissed,
 *   4. conversation resume — messages the hook returns on mount (persisted
 *      history) render in the transcript.
 *
 * Also covers the AI SDK v6 array-of-parts content shape that
 * `getMessageContent` normalizes defensively.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

// Stable mock factory — `jest.mock` is hoisted by the Jest transform, so the
// hook is mocked here and its returned state patched per test below. The
// component under test re-invokes the hook on every render, so `rerender`
// with an updated mockReturnValue simulates the hook emitting new stream
// state (progressive tokens, status transitions).
jest.mock("@/hooks/use-game-chat", () => ({
  useGameChat: jest.fn(),
}));

import { useGameChat } from "@/hooks/use-game-chat";
import type { GameChatMessage, GameChatStatus } from "@/hooks/use-game-chat";
import { AICoachChatPanel } from "@/components/ai-coach/chat-panel";

const mockedHook = jest.mocked(useGameChat);
const sendMessage = jest.fn();

const PANEL_PROPS = {
  currentPlayerId: "player-1",
  currentPlayerName: "Alex",
} as const;

function setChatState(
  messages: GameChatMessage[],
  status: GameChatStatus,
): void {
  mockedHook.mockReturnValue({
    messages,
    status,
    error: status === "error" ? new Error("backend unavailable") : null,
    sendMessage,
    stop: jest.fn(),
    clearMessages: jest.fn(),
    unreadCount: 0,
    markAsRead: jest.fn(),
    legacyMessages: [],
    ...PANEL_PROPS,
  });
}

function renderPanel() {
  return render(<AICoachChatPanel {...PANEL_PROPS} />);
}

function rerenderPanel(rerender: ReturnType<typeof render>["rerender"]) {
  rerender(<AICoachChatPanel {...PANEL_PROPS} />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Message send
// ---------------------------------------------------------------------------

describe("AICoachChatPanel — message send", () => {
  it("wires the panel to the hook with the player identity props", () => {
    setChatState([], "ready");
    renderPanel();

    expect(mockedHook).toHaveBeenCalledWith({ ...PANEL_PROPS });
  });

  it("sends the typed text through the hook's sendMessage and clears the input", () => {
    setChatState([], "ready");
    renderPanel();

    const input = screen.getByPlaceholderText("How can I improve my win rate?");
    fireEvent.change(input, { target: { value: "How do I beat control?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith("How do I beat control?");
    expect(input).toHaveValue("");
  });

  it("does not send an empty or whitespace-only message", () => {
    setChatState([], "ready");
    renderPanel();

    const input = screen.getByPlaceholderText("How can I improve my win rate?");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Streaming tokens render incrementally
// ---------------------------------------------------------------------------

describe("AICoachChatPanel — streaming tokens", () => {
  const QUESTION = "How can I improve my aggro matchup?";

  it("renders streamed tokens incrementally as the hook reports them", () => {
    // Turn starts: the user message is echoed and the panel is "submitted".
    setChatState([{ id: "u1", role: "user", content: QUESTION }], "submitted");
    const { rerender } = renderPanel();

    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(screen.getByText("submitted")).toBeInTheDocument();

    // First token batch arrives — status flips to "streaming".
    setChatState(
      [
        { id: "u1", role: "user", content: QUESTION },
        { id: "a1", role: "assistant", content: "Lightning" },
      ],
      "streaming",
    );
    rerenderPanel(rerender);

    expect(screen.getByText("streaming")).toBeInTheDocument();
    expect(screen.getByText("Lightning")).toBeInTheDocument();

    // More tokens append — the partial render grows.
    setChatState(
      [
        { id: "u1", role: "user", content: QUESTION },
        { id: "a1", role: "assistant", content: "Lightning Strike" },
      ],
      "streaming",
    );
    rerenderPanel(rerender);

    expect(screen.getByText("Lightning Strike")).toBeInTheDocument();

    // Stream completes — the full answer stays and the status returns to
    // "Ready" with the input re-enabled.
    setChatState(
      [
        { id: "u1", role: "user", content: QUESTION },
        {
          id: "a1",
          role: "assistant",
          content: "Lightning Strike keeps aggressive decks honest.",
        },
      ],
      "ready",
    );
    rerenderPanel(rerender);

    expect(
      screen.getByText("Lightning Strike keeps aggressive decks honest."),
    ).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("How can I improve my win rate?"),
    ).toBeEnabled();
  });

  it("disables the input and send button while a response is in flight", () => {
    setChatState(
      [
        { id: "u1", role: "user", content: "hi" },
        { id: "a1", role: "assistant", content: "" },
      ],
      "streaming",
    );
    renderPanel();

    expect(
      screen.getByPlaceholderText("How can I improve my win rate?"),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Error / fallback display (issue #1009 graceful degradation)
// ---------------------------------------------------------------------------

describe("AICoachChatPanel — error fallback", () => {
  it("renders the Coming Soon placeholder on error status, with the fallback assistant text", () => {
    setChatState(
      [
        { id: "u1", role: "user", content: "hi" },
        {
          id: "a1",
          role: "assistant",
          // What useGameChat patches in when the stream fails with no
          // partial text.
          content: "Sorry — the AI assistant is unavailable right now.",
        },
      ],
      "error",
    );
    renderPanel();

    expect(
      screen.getByText("Conversational Coach — Coming Soon"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/heuristic coaching are available right now/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sorry — the AI assistant is unavailable right now."),
    ).toBeInTheDocument();
  });

  it("hides the placeholder once dismissed", () => {
    setChatState([], "error");
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(
      screen.queryByText("Conversational Coach — Coming Soon"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Conversation resume from storage
// ---------------------------------------------------------------------------

describe("AICoachChatPanel — conversation resume", () => {
  it("renders the persisted history the hook returns on mount", () => {
    // The hook hydrates from its persistence layer before/during the first
    // render; the component contract is simply that whatever `messages` it
    // returns renders in the transcript.
    setChatState(
      [
        {
          id: "m1",
          role: "user",
          content: "What should I cut for Rhystic Study?",
        },
        {
          id: "m2",
          role: "assistant",
          content:
            "Cut Divination — Rhystic Study draws more over a long game.",
        },
        { id: "m3", role: "user", content: "And my curve?" },
        {
          id: "m4",
          role: "assistant",
          content: "Add one more two-mana rock to smooth your draws.",
        },
      ],
      "ready",
    );
    renderPanel();

    expect(
      screen.getByText("What should I cut for Rhystic Study?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cut Divination — Rhystic Study draws more over a long game.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("And my curve?")).toBeInTheDocument();
    expect(
      screen.getByText("Add one more two-mana rock to smooth your draws."),
    ).toBeInTheDocument();

    // A resumed conversation is not the empty state.
    expect(
      screen.queryByText(/Ask me anything about your deck/i),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Message content shapes (AI SDK v6 defensive normalization)
// ---------------------------------------------------------------------------

describe("AICoachChatPanel — message content shapes", () => {
  it("renders array-of-parts content by joining its text parts", () => {
    setChatState(
      [
        {
          id: "a1",
          role: "assistant",
          // AI SDK v6 can deliver content as parts; the panel normalizes.
          content: [
            { type: "text", text: "Array-shaped " },
            { type: "tool-call", toolName: "searchCards" },
            { type: "text", text: "reply renders." },
          ],
        } as unknown as GameChatMessage,
      ],
      "ready",
    );
    renderPanel();

    expect(screen.getByText("Array-shaped reply renders.")).toBeInTheDocument();
  });
});
