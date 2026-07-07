"use client";

import { useRef, useEffect } from "react";
import { Bot, Loader2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMessageList } from "./chat-message-list";
import { ChatInput } from "./chat-input";
import { TypingIndicator } from "./typing-indicator";
import type { ChatMessage } from "@/types/chat";

interface DeckCoachChatPanelProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  onSendMessage: (content: string) => void;
  /** Abort the in-flight generation (issue #1077). Shown as a Cancel button. */
  onCancel?: () => void;
  className?: string;
}

export function DeckCoachChatPanel({
  messages,
  isLoading = false,
  onSendMessage,
  onCancel,
  className,
}: DeckCoachChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to bottom when new messages arrive or loading state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // The most recent assistant message carries the latest token-usage telemetry
  // surfaced by the stream (issue #1077).
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const canCancel = isLoading && typeof onCancel === "function";

  return (
    <div
      className={cn(
        "flex flex-col h-[500px] border rounded-lg bg-card shadow-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b bg-muted/20">
        <Bot className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-sm">AI Coach Chat</h3>
        <div className="ml-auto flex items-center gap-2">
          {lastAssistant?.provider && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {lastAssistant.provider}
            </span>
          )}
          {lastAssistant?.usage && lastAssistant.usage.totalTokens > 0 && (
            <span
              className="text-[10px] text-muted-foreground font-medium"
              title={`${lastAssistant.usage.promptTokens} prompt + ${lastAssistant.usage.completionTokens} completion tokens`}
            >
              {lastAssistant.usage.totalTokens} tok
            </span>
          )}
          {isLoading && (
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
          )}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {isLoading ? "Thinking..." : "Ready"}
          </span>
          {canCancel && (
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              aria-label="Cancel generation"
              title="Cancel generation"
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Square className="w-3 h-3" aria-hidden="true" />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ChatMessageList
        messages={messages}
        isLoading={isLoading}
        className="flex-1"
      />

      {/* Typing Indicator */}
      {isLoading && (
        <div className="px-4 pb-2">
          <TypingIndicator />
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={onSendMessage}
        disabled={isLoading}
        placeholder="Ask about your deck, cards, or strategy..."
      />

      <div ref={messagesEndRef} />
    </div>
  );
}
