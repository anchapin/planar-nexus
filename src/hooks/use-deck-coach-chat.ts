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
import {
  COACH_CONVERSATION_STORE,
  DEFAULT_DECK_ID,
  type CoachConversation,
  type CoachConversationDeckContext,
  type CoachConversationImportResult,
  clearAllCoachConversations,
  createConversationRecord,
  deleteConversation,
  deleteConversationsForDeck,
  deriveConversationTitle,
  exportConversationsForDeck,
  importConversationsFromJSON,
  loadConversation,
  loadConversations,
  loadMostRecentConversation,
  parseCoachConversationExport,
  saveConversation,
} from "@/lib/coach-conversation-storage";
import {
  isQuotaExceededError,
  type QuotaExceededError,
} from "@/lib/storage-quota";

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

/** Legacy localStorage key helper (kept only to clear stale pre-#1074 data). */
function getStorageKey(deckId?: string): string {
  if (!deckId) return BASE_STORAGE_KEY;
  return `${BASE_STORAGE_KEY}-${deckId}`;
}

export interface UseDeckCoachChatOptions {
  initialMessages?: ChatMessage[];
  deckCards?: DeckCard[];
  format?: string;
  archetype?: string;
  strategy?: string;
  deckId?: string; // Scope conversations to a deck; "default" when unset.
}

export interface UseDeckCoachChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  /** Persisted conversations for the active deck, newest-first. */
  conversations: CoachConversation[];
  /** id of the conversation currently loaded into the chat, if any. */
  activeConversationId: string | null;
  /**
   * Human-readable storage notice when persistence is degraded (e.g. quota
   * exceeded). `null` when persistence is healthy. The in-session coach keeps
   * working regardless — this is purely informational (issue #1074/#1085).
   */
  storageNotice: string | null;
  sendMessage: (content: string, options?: ChatRequestOptions) => Promise<void>;
  cancelGeneration: () => void;
  addAssistantMessage: (content: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  /** Load a past conversation into the chat (resume). */
  resumeConversation: (conversationId: string) => Promise<void>;
  /** Start a fresh conversation (clears the chat; next send creates a record). */
  startNewConversation: () => void;
  /** Delete a persisted conversation by id. */
  removeConversation: (conversationId: string) => Promise<void>;
  /**
   * Serialize the active deck's conversations to a JSON string for portability
   * (issue #1242). Returns `null` when there are no conversations to export.
   */
  exportActiveDeckToJSON: () => Promise<string | null>;
  /**
   * Parse + import a previously-exported JSON envelope. Imported conversations
   * are scoped to the active deck by default (so they appear in the sidebar
   * immediately); pass `scope: "original"` to preserve each record's original
   * `deckId`. Returns counts so the UI can show a meaningful toast.
   */
  importFromJSON: (
    json: string,
    options?: { scope?: "active" | "original" },
  ) => Promise<CoachConversationImportResult | { error: string }>;
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
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);

  const messagesRef = useRef(messages);
  const deckIdRef = useRef(options.deckId);
  /** Live deck context (format/archetype/strategy/cards) from options/overrides. */
  const deckContextRef = useRef<CoachConversationDeckContext>({});
  /** id of the conversation currently loaded into the chat. */
  const activeConversationIdRef = useRef<string | null>(null);
  /** True once the user has interacted (sent/resumed/started/cleared). */
  const interactedRef = useRef(false);
  /** True once the initial auto-resume has run for the current deck. */
  const hydratedRef = useRef(false);

  /**
   * AbortController for the in-flight coach stream. The Cancel button aborts
   * it; the fetch rejects with an AbortError which the stream loop treats as a
   * user-initiated stop rather than a failure (issue #1077).
   */
  const abortControllerRef = useRef<AbortController | null>(null);
  /** id of the assistant message currently being streamed into. */
  const streamingMessageIdRef = useRef<string | null>(null);

  /**
   * Apply a messages update and keep {@link messagesRef} in sync *synchronously*.
   *
   * React's state is asynchronous, and an effect-based ref mirror only runs
   * after commit — too late for `persistCurrent`, which reads the ref inside
   * `sendMessage`'s `finally` before effects flush. Updating the ref here (from
   * the previous ref value, not the updater's `prev`) keeps it deterministic so
   * the finalized assistant message (provider/usage/cancelled) is captured by
   * the single post-completion write (issue #1074).
   */
  const updateMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      const next = updater(messagesRef.current);
      messagesRef.current = next;
      setMessages(next);
    },
    [],
  );

  /** Resolve the effective deck id for the current scope. */
  const getDeckId = useCallback(() => deckIdRef.current || DEFAULT_DECK_ID, []);

  /** Sync the latest option-supplied deck context into the ref. */
  const refreshDeckContext = useCallback(() => {
    deckContextRef.current = {
      format: options.format,
      archetype: options.archetype,
      strategy: options.strategy,
      deckCards: options.deckCards,
    };
  }, [options.format, options.archetype, options.strategy, options.deckCards]);

  /** Refresh the persisted-conversation list for the active deck. */
  const refreshConversations = useCallback(async () => {
    const list = await loadConversations(getDeckId());
    setConversations(list);
  }, [getDeckId]);

  // messagesRef is kept synchronously in sync by `updateMessages` (see below);
  // no effect-based mirror is needed.

  /**
   * Persist the current chat state (messages + live deck context) to IndexedDB.
   * Creates a conversation record on first save and updates it thereafter.
   * Quota errors surface as a `storageNotice` and never throw (issue #1074).
   */
  const persistCurrent = useCallback(async () => {
    const currentMessages = messagesRef.current;
    // Nothing meaningful to persist yet (no user content).
    if (currentMessages.length === 0) return;

    refreshDeckContext();
    const now = new Date().toISOString();
    const existingId = activeConversationIdRef.current;

    let record: CoachConversation;
    if (existingId) {
      const existing = await loadConversation(existingId);
      record = existing
        ? {
            ...existing,
            title: deriveConversationTitle(currentMessages),
            deckContext: deckContextRef.current,
            messages: currentMessages,
            updatedAt: now,
          }
        : createConversationRecord({
            id: existingId,
            deckId: getDeckId(),
            messages: currentMessages,
            deckContext: deckContextRef.current,
            now: new Date(now),
          });
    } else {
      const newId = crypto.randomUUID();
      activeConversationIdRef.current = newId;
      record = createConversationRecord({
        id: newId,
        deckId: getDeckId(),
        messages: currentMessages,
        deckContext: deckContextRef.current,
        now: new Date(now),
      });
    }

    const result = await saveConversation(record);
    if (!result.ok) {
      if (isQuotaExceededError(result.error)) {
        const storeName = (result.error as QuotaExceededError).storeName;
        setStorageNotice(
          `Storage is full — this conversation isn't being saved, but the coach still works this session.` +
            (storeName ? ` (${storeName})` : ""),
        );
      } else {
        setStorageNotice(
          "Couldn't save this conversation locally — the coach still works this session.",
        );
      }
      return;
    }
    // Healthy write: clear any prior notice and refresh the sidebar list.
    setStorageNotice(null);
    await refreshConversations();
    setActiveConversationId(activeConversationIdRef.current);
  }, [getDeckId, refreshConversations, refreshDeckContext]);

  // Load most-recent conversation + list when deckId changes (auto-resume).
  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;
    interactedRef.current = false;
    deckIdRef.current = options.deckId;
    refreshDeckContext();

    (async () => {
      // Clear stale legacy localStorage history from pre-#1074 builds.
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem(getStorageKey(options.deckId));
        } catch {
          /* ignore */
        }
      }

      const [recent, list] = await Promise.all([
        loadMostRecentConversation(options.deckId || DEFAULT_DECK_ID),
        loadConversations(options.deckId || DEFAULT_DECK_ID),
      ]);
      if (cancelled) return;

      setConversations(list);
      // Race guard: if the user started interacting before this async load
      // resolved (e.g. sent a message immediately on mount), do NOT clobber
      // their in-progress state with the resumed history (issue #1074).
      if (interactedRef.current) {
        hydratedRef.current = true;
        return;
      }
      if (recent && recent.messages.length > 0) {
        activeConversationIdRef.current = recent.id;
        setActiveConversationId(recent.id);
        messagesRef.current = recent.messages;
        setMessages(recent.messages);
        deckContextRef.current = recent.deckContext ?? {};
      } else {
        activeConversationIdRef.current = null;
        setActiveConversationId(null);
        const initial = options.initialMessages ?? [];
        messagesRef.current = initial;
        setMessages(initial);
      }
      hydratedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.deckId]);

  const addMessage = useCallback(
    (content: string, role: ChatMessageRole) => {
      const newMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role,
        content,
        timestamp: new Date(),
      };
      updateMessages((prev) => [...prev, newMessage]);
      return newMessage;
    },
    [updateMessages],
  );

  const addAssistantMessage = useCallback(
    (content: string) => {
      addMessage(content, "assistant");
    },
    [addMessage],
  );

  const sendMessage = useCallback(
    async (content: string, chatOptions: ChatRequestOptions = {}) => {
      // Mark as interacted so a late auto-resume load can't clobber this turn.
      interactedRef.current = true;
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

      updateMessages((prev) => [...prev, initialAssistantMsg]);
      streamingMessageIdRef.current = assistantMsgId;

      // AbortController enables the Cancel button (issue #1077).
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Helper to patch the streaming assistant message immutably.
      const patchAssistant = (patch: Partial<ChatMessage>) => {
        const id = streamingMessageIdRef.current;
        if (!id) return;
        updateMessages((prev) =>
          prev.map((msg) =>
            msg.id === id && msg.role === "assistant"
              ? { ...msg, ...patch }
              : msg,
          ),
        );
      };

      // Persist the user's message immediately so it survives a refresh even if
      // the stream is interrupted mid-flight (issue #1074). The finalized
      // assistant message is persisted again in `finally` below.
      void persistCurrent();

      try {
        const currentDeckCards =
          chatOptions.deckCards || options.deckCards || [];
        const currentFormat =
          chatOptions.format || options.format || "commander";
        const currentArchetype = chatOptions.archetype || options.archetype;
        const currentStrategy = chatOptions.strategy || options.strategy;
        // Update live context so the persisted snapshot reflects this turn.
        deckContextRef.current = {
          format: currentFormat,
          archetype: currentArchetype,
          strategy: currentStrategy,
          deckCards: currentDeckCards,
        };

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
          updateMessages((prev) =>
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
        // Persist the finalized assistant message (with provider/usage/cancelled
        // attached by the stream). This is the single post-completion write — we
        // deliberately do NOT write on every streaming token (issue #1074).
        await persistCurrent();
      }
    },
    [
      addMessage,
      updateMessages,
      options.deckCards,
      options.format,
      options.archetype,
      options.strategy,
      persistCurrent,
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
    interactedRef.current = true;
    messagesRef.current = [];
    setMessages([]);
    const id = activeConversationIdRef.current;
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    if (id) {
      void deleteConversation(id).then(refreshConversations);
    } else {
      // No active record to delete; still clear any deck-scoped legacy data.
      void deleteConversationsForDeck(getDeckId()).then(refreshConversations);
    }
  }, [getDeckId, refreshConversations]);

  const resumeConversation = useCallback(async (conversationId: string) => {
    interactedRef.current = true;
    // Abort any in-flight stream before switching context.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamingMessageIdRef.current = null;
    setIsLoading(false);

    const conv = await loadConversation(conversationId);
    if (!conv) return;
    activeConversationIdRef.current = conv.id;
    setActiveConversationId(conv.id);
    messagesRef.current = conv.messages;
    setMessages(conv.messages);
    deckContextRef.current = conv.deckContext ?? {};
    setStorageNotice(null);
  }, []);

  const startNewConversation = useCallback(() => {
    interactedRef.current = true;
    // Abort any in-flight stream before starting fresh.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamingMessageIdRef.current = null;
    setIsLoading(false);
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    messagesRef.current = [];
    setMessages([]);
    setStorageNotice(null);
  }, []);

  const removeConversation = useCallback(
    async (conversationId: string) => {
      interactedRef.current = true;
      await deleteConversation(conversationId);
      if (activeConversationIdRef.current === conversationId) {
        activeConversationIdRef.current = null;
        setActiveConversationId(null);
        messagesRef.current = [];
        setMessages([]);
      }
      await refreshConversations();
    },
    [refreshConversations],
  );

  /**
   * Serialize the active deck's conversations to a JSON string. Returns `null`
   * when there is nothing to export so the UI can skip the download prompt
   * (issue #1242).
   */
  const exportActiveDeckToJSON = useCallback(async (): Promise<string | null> => {
    const deckId = getDeckId();
    const envelope = await exportConversationsForDeck(deckId);
    if (envelope.conversations.length === 0) return null;
    return JSON.stringify(envelope, null, 2);
  }, [getDeckId]);

  /**
   * Parse + import a previously-exported JSON envelope. Imported records are
   * re-scoped to the active deck by default so the sidebar updates immediately;
   * the caller can opt back into preserving each record's original `deckId`.
   */
  const importFromJSON = useCallback(
    async (
      json: string,
      options: { scope?: "active" | "original" } = {},
    ): Promise<CoachConversationImportResult | { error: string }> => {
      const envelope = parseCoachConversationExport(json);
      if (!envelope) {
        return { error: "That file isn't a recognised coach-session export." };
      }
      const targetDeckId =
        options.scope === "original" ? null : getDeckId();
      const result = await importConversationsFromJSON(envelope, {
        targetDeckId,
        replace: false,
      });
      // The sidebar just gained new entries — refresh it.
      await refreshConversations();
      return result;
    },
    [getDeckId, refreshConversations],
  );

  return {
    messages,
    isLoading,
    isStreaming: isLoading,
    conversations,
    activeConversationId,
    storageNotice,
    sendMessage,
    cancelGeneration,
    addAssistantMessage,
    clearMessages,
    setLoading: setIsLoading,
    resumeConversation,
    startNewConversation,
    removeConversation,
    exportActiveDeckToJSON,
    importFromJSON,
  };
}

// Re-export store name + clearAll for tests/inspection.
export { COACH_CONVERSATION_STORE, clearAllCoachConversations };
