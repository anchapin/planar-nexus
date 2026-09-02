"use client";

import { useState, useCallback, useRef, useMemo } from "react";

/**
 * Hook for the in-game chat against the hardened `/api/chat` endpoint
 * (issue #1534).
 *
 * The route was re-wired to delegate to the same shared pipeline as
 * `/api/chat/coach` and now emits the coach Server-Sent-Events protocol
 * (`data: {"type":"text"|"usage"|"error"|"done",...}` lines) instead of a raw
 * text stream, so this hook parses SSE directly (mirroring
 * `use-deck-coach-chat`). The public shape is unchanged — consumers
 * (`game-board` page, `ai-coach/chat-panel`) keep their existing contract:
 * `messages`, `status`, `sendMessage`, `clearMessages`, `unreadCount`,
 * `markAsRead`, `legacyMessages`.
 */

/** Statuses mirror the useChat states the previous implementation exposed. */
export type GameChatStatus = "ready" | "submitted" | "streaming" | "error";

export interface GameChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface CoachStreamEventPayload {
  type: "provider" | "failover" | "text" | "usage" | "error" | "done";
  value?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `game-chat-${Date.now()}-${messageSeq}`;
}

export function useGameChat({
  currentPlayerId,
  currentPlayerName,
}: {
  currentPlayerId: string;
  currentPlayerName: string;
}) {
  const [messages, setMessages] = useState<GameChatMessage[]>([]);
  const [status, setStatus] = useState<GameChatStatus>("ready");
  const [error, setError] = useState<Error | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Mirror of `messages` so the in-flight request always sends the full,
  // current history (React state updates are async).
  const messagesRef = useRef<GameChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const setBoth = useCallback(
    (updater: (prev: GameChatMessage[]) => GameChatMessage[]) => {
      setMessages((prev) => {
        const next = updater(prev);
        messagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBoth(() => []);
    setStatus("ready");
    setError(null);
  }, [setBoth]);

  const markAsRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || status === "submitted" || status === "streaming") return;

      const userMessage: GameChatMessage = {
        id: nextMessageId(),
        role: "user",
        content: trimmed,
      };
      const assistantId = nextMessageId();
      const history = [...messagesRef.current, userMessage];
      setBoth(() => [
        ...history,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setStatus("submitted");
      setError(null);

      void (async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        let assistantContent = "";
        const patchAssistant = (patch: { content?: string }) => {
          setBoth((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
          );
        };

        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              messages: history.map(({ role, content }) => ({ role, content })),
            }),
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            throw new Error(
              `Chat request failed: ${response.status} ${response.statusText}`,
            );
          }

          setStatus("streaming");

          // Parse the SSE event stream (one JSON event per `data:` line).
          // Chunks may split events arbitrarily, so buffer until `\n\n`.
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          let sawDone = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              let event: CoachStreamEventPayload;
              try {
                event = JSON.parse(
                  line.slice("data: ".length),
                ) as CoachStreamEventPayload;
              } catch {
                // Malformed event line: skip rather than kill the stream.
                continue;
              }
              if (event.type === "error") {
                throw new Error(
                  event.value || "The chat provider returned an error.",
                );
              }
              if (event.type === "text") {
                assistantContent += event.value ?? "";
                patchAssistant({ content: assistantContent });
              }
              if (event.type === "done") sawDone = true;
            }
            if (sawDone) break;
          }
          setStatus("ready");
        } catch (streamError) {
          if (controller.signal.aborted) {
            // User-initiated cancel: keep partial text, return to ready.
            setStatus("ready");
          } else {
            const fallback =
              streamError instanceof Error
                ? streamError
                : new Error("Chat request failed.");
            setError(fallback);
            setStatus("error");
            patchAssistant({
              content:
                assistantContent ||
                "Sorry — the AI assistant is unavailable right now.",
            });
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      })();
    },
    [setBoth, status],
  );

  const legacyMessages = useMemo(() => {
    return messages.map((m) => ({
      id: m.id,
      playerId: m.role === "user" ? currentPlayerId : "ai-coach",
      playerName: m.role === "user" ? currentPlayerName : "AI Coach",
      content: typeof m.content === "string" ? m.content : "",
      timestamp: Date.now(),
      isSystem: false,
      toolInvocations: undefined,
    }));
  }, [messages, currentPlayerId, currentPlayerName]);

  return {
    messages,
    status,
    error,
    sendMessage,
    stop,
    clearMessages,
    unreadCount,
    markAsRead,
    legacyMessages,
    currentPlayerId,
    currentPlayerName,
  };
}
