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
  /**
   * True when the post-generation grounding guard (issue #1419) flagged one
   * or more claims in this assistant message as ungrounded against the
   * evidence ledger. The message is still persisted (with an appended
   * caveat), but the UI should render a low-confidence marker.
   */
  lowConfidence?: boolean;
  /**
   * Alias for {@link lowConfidence}. Matches the issue's `needsReview`
   * terminology; set together with {@link lowConfidence} so callers can
   * query either name.
   */
  needsReview?: boolean;
  /**
   * Stable descriptions of the grounding failures detected for this message
   * (issue #1419). Empty / undefined when the message was fully grounded.
   * Surfaced for telemetry and so the UI can list the ungrounded claims.
   */
  groundingFailures?: string[];
}

export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}
