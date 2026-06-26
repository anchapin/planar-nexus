/**
 * Chat message types for the AI Deck Coach
 */

export type ChatMessageRole = "user" | "assistant" | "system";

/**
 * Normalized token-usage telemetry attached to an assistant message so it can
 * be displayed per-message (issue #1077). Optional because usage is only known
 * for streamed LLM responses.
 */
export interface ChatTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: Date;
  /** Provider that produced this assistant message, when known. */
  provider?: string;
  /** Token usage for this assistant message, when reported by the provider. */
  usage?: ChatTokenUsage;
  /** True when the user cancelled generation before it completed. */
  cancelled?: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}
