"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type {
  ChatMessage,
  ChatMessageRole,
  ChatTokenUsage,
} from "@/types/chat";
import { DeckCard } from "@/ai/flows/context-builder";
import { aiWorkerClient } from "@/ai/worker/ai-worker-client";
import type { DigestedCoachContext } from "@/ai/worker/worker-types";

const BASE_STORAGE_KEY = "deck-coach-chat-history";

/**
 * Shape of a single Server-Sent-Event emitted by the `/api/chat/coach`
 * route. Mirrors the server-side `CoachStreamEvent` (issue #1077) so the
 * client can switch on `type` without depending on server-only modules.
 */
type CoachStreamEventPayload =
  | { type: "provider"; value: string }
  | { type: "failover"; from: string; to: string; reason: string }
  | { type: "text"; value: string }
  | {
      type: "usage";
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    }
  | { type: "error"; value: string }
  | { type: "done" };

/**
 * Parse one raw SSE event block (the text between two `\n\n` separators) into
 * a {@link CoachStreamEventPayload}. Returns `null` for blank lines, comments,
 * or malformed JSON so the read loop can skip them safely.
 */
function parseSseEvent(rawEvent: string): CoachStreamEventPayload | null {
  const dataLine = rawEvent
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));

  if (!dataLine) return null;

  const payload = dataLine.slice("data:".length).trim();
  if (!payload || payload === "[DONE]") return null;

  try {
    return JSON.parse(payload) as CoachStreamEventPayload;
  } catch {
    return null;
  }
}

function getStorageKey(deckId?: string): string {
  if (!deckId) return BASE_STORAGE_KEY;
  return `${BASE_STORAGE_KEY}-${deckId}`;
}

function loadFromStorage(deckId?: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const key = getStorageKey(deckId);
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((m: ChatMessage) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    }
  } catch (e) {
    console.error("Failed to load chat history:", e);
  }
  return [];
}

function saveToStorage(messages: ChatMessage[], deckId?: string) {
  if (typeof window === "undefined") return;
  try {
    const key = getStorageKey(deckId);
    localStorage.setItem(key, JSON.stringify(messages));
  } catch (e) {
    console.error("Failed to save chat history:", e);
  }
}

export interface UseDeckCoachChatOptions {
  initialMessages?: ChatMessage[];
  deckCards?: DeckCard[];
  format?: string;
  archetype?: string;
  strategy?: string;
  deckId?: string; // Add deckId for isolation
}

export interface UseDeckCoachChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  sendMessage: (content: string, options?: ChatRequestOptions) => Promise<void>;
  cancelGeneration: () => void;
  addAssistantMessage: (content: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
}

export interface ChatRequestOptions {
  deckCards?: DeckCard[];
  format?: string;
  archetype?: string;
  strategy?: string;
  gameState?: any;
  playerId?: string;
}

export function useDeckCoachChat(
  options: UseDeckCoachChatOptions = {},
): UseDeckCoachChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesRef = useRef(messages);
  const deckIdRef = useRef(options.deckId);
  /**
   * AbortController for the in-flight coach stream. The Cancel button aborts
   * it; the fetch rejects with an AbortError which the stream loop treats as a
   * user-initiated stop rather than a failure (issue #1077).
   */
  const abortControllerRef = useRef<AbortController | null>(null);
  /** Id of the assistant message currently being streamed into. */
  const streamingMessageIdRef = useRef<string | null>(null);

  // Load messages when deckId changes
  useEffect(() => {
    const stored = loadFromStorage(options.deckId);
    setMessages(stored.length > 0 ? stored : (options.initialMessages ?? []));
    deckIdRef.current = options.deckId;
  }, [options.deckId, options.initialMessages]);

  // Keep ref in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Persist to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      saveToStorage(messages, deckIdRef.current);
    }
  }, [messages]);

  const addMessage = useCallback((content: string, role: ChatMessageRole) => {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  }, []);

  const addAssistantMessage = useCallback(
    (content: string) => {
      addMessage(content, "assistant");
    },
    [addMessage],
  );

  const sendMessage = useCallback(
    async (content: string, chatOptions: ChatRequestOptions = {}) => {
      // 1. Add user message
      const userMessage = addMessage(content, "user");

      // 2. Prepare for assistant response
      setIsLoading(true);

      // Create a placeholder for the assistant message that we'll stream into
      const assistantMsgId = crypto.randomUUID();
      const initialAssistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, initialAssistantMsg]);
      streamingMessageIdRef.current = assistantMsgId;

      // AbortController enables the Cancel button (issue #1077).
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Helper to patch the streaming assistant message immutably.
      const patchAssistant = (patch: Partial<ChatMessage>) => {
        const id = streamingMessageIdRef.current;
        if (!id) return;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === id && msg.role === "assistant"
              ? { ...msg, ...patch }
              : msg,
          ),
        );
      };

      try {
        const currentDeckCards =
          chatOptions.deckCards || options.deckCards || [];
        const currentFormat =
          chatOptions.format || options.format || "commander";
        const currentArchetype = chatOptions.archetype || options.archetype;
        const currentStrategy = chatOptions.strategy || options.strategy;

        // Payload reduction: if the deck is large, use digested context
        let digestedContext: DigestedCoachContext | undefined;
        let payloadDeck: DeckCard[] | undefined = currentDeckCards;

        if (currentDeckCards.length > 20 || chatOptions.gameState) {
          try {
            const api = aiWorkerClient.api;
            if (api) {
              digestedContext = await api.prepareCoachContext({
                deck: currentDeckCards,
                gameState: chatOptions.gameState,
                playerId: chatOptions.playerId,
              });

              // If we have a successful digest, we can omit the full deck cards to save bandwidth
              if (digestedContext) {
                payloadDeck = undefined;
              }
            }
          } catch (error) {
            console.error(
              "Context digestion failed, falling back to full payload:",
              error,
            );
          }
        }

        const response = await fetch("/api/chat/coach", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // SSE stream — signal progress events (provider/failover/usage/done).
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            // `messagesRef` lags React state by one render (effects flush after
            // the awaited fetch resolves), so the just-added user message may
            // not be present yet. Build the outgoing history defensively: take
            // the synced history, drop the empty streaming placeholder, and
            // ensure the current user message appears exactly once. Without
            // this the coach never receives the user's question (issue #1077).
            messages: (() => {
              const history = messagesRef.current.filter(
                (m) => m.id !== assistantMsgId,
              );
              const alreadyPresent = history.some(
                (m) => m.id === userMessage.id,
              );
              return alreadyPresent ? history : [...history, userMessage];
            })(),
            deckCards: payloadDeck,
            digestedContext,
            format: currentFormat,
            archetype: currentArchetype,
            strategy: currentStrategy,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to send message: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        // Parse the SSE event stream and render progressively (issue #1077).
        // The route emits one JSON event per `data:` line; chunks may split
        // events arbitrarily so we buffer until a `\n\n` separator arrives.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantContent = "";

        const handleEvent = (event: CoachStreamEventPayload) => {
          switch (event.type) {
            case "provider":
              patchAssistant({ provider: event.value });
              break;
            case "text":
              assistantContent += event.value;
              patchAssistant({ content: assistantContent });
              break;
            case "usage": {
              const usage: ChatTokenUsage = {
                promptTokens: event.usage.promptTokens,
                completionTokens: event.usage.completionTokens,
                totalTokens: event.usage.totalTokens,
              };
              patchAssistant({ usage });
              break;
            }
            case "error":
              // Surface server-side errors inline (preserving any partial text).
              assistantContent += `${assistantContent ? "\n\n" : ""}_${event.value}_`;
              patchAssistant({ content: assistantContent });
              break;
            case "failover":
              // Transient telemetry; not rendered inline. Could be surfaced in UI later.
              break;
            case "done":
              // Stream finished; content is already up to date.
              break;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          let separatorIndex: number;
          while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            const parsed = parseSseEvent(rawEvent);
            if (parsed) handleEvent(parsed);
          }
        }
      } catch (error) {
        const isAbort =
          error instanceof DOMException && error.name === "AbortError";

        if (isAbort) {
          // User-initiated cancel: mark the partial message instead of erroring.
          patchAssistant({ cancelled: true });
        } else {
          console.error("Chat error:", error);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    content: "Sorry, I encountered an error. Please try again.",
                  }
                : msg,
            ),
          );
        }
      } finally {
        abortControllerRef.current = null;
        streamingMessageIdRef.current = null;
        setIsLoading(false);
      }
    },
    [
      addMessage,
      options.deckCards,
      options.format,
      options.archetype,
      options.strategy,
    ],
  );

  const cancelGeneration = useCallback(() => {
    const controller = abortControllerRef.current;
    if (controller) {
      controller.abort();
      abortControllerRef.current = null;
    }
    // Optimistically flag the partial message; the stream loop's AbortError
    // handler will also set `cancelled: true`. Loading is cleared there.
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(getStorageKey(deckIdRef.current));
  }, []);

  return {
    messages,
    isLoading,
    isStreaming: isLoading,
    sendMessage,
    cancelGeneration,
    addAssistantMessage,
    clearMessages,
    setLoading: setIsLoading,
  };
}
