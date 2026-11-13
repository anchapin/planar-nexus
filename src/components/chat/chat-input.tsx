"use client";

import {
  useState,
  useRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * React's keyboard-event type does not declare `isComposing` in every
 * `@types/react` release, so widen it locally (issue #2963).
 */
type IMEKeyboardEvent<T = Element> = KeyboardEvent<T> & {
  isComposing?: boolean;
};

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Type your message...",
  className,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      if (input.trim() && !disabled) {
        onSend(input.trim());
        setInput("");
        // Restore focus after sending
        textareaRef.current?.focus();
      }
    },
    [input, disabled, onSend],
  );

  const handleKeyDown = useCallback(
    (e: IMEKeyboardEvent<HTMLTextAreaElement>) => {
      // IME-safe Enter (issue #2963): while an IME composition is active the
      // Enter key confirms the candidate word — it must NOT submit. The
      // `keyCode === 229` check covers browsers that do not expose
      // `isComposing` on the keyboard event, and the native event is consulted
      // as well because React does not always copy `isComposing` onto the
      // synthetic one.
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.isComposing &&
        e.keyCode !== 229 &&
        !e.nativeEvent.isComposing
      ) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Auto-resize textarea
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      // Progressive enhancement (issue #2963): with `field-sizing: content`
      // the browser grows the textarea natively (still capped by
      // `max-h-[150px]`), so the imperative resize below is only the fallback
      // and must run when `!CSS.supports("field-sizing", "content")`.
      const needsJsResize =
        typeof CSS === "undefined" ||
        typeof CSS.supports !== "function" ||
        !CSS.supports("field-sizing", "content");
      if (needsJsResize && textareaRef.current) {
        // Reset height to auto to calculate new height
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
      }
    },
    [],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("p-3 border-t bg-muted/5", className)}
    >
      <div className="flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="min-h-[44px] max-h-[150px] resize-none shadow-none border-none focus-visible:ring-1 [field-sizing:content]"
          aria-label="Chat message input"
          rows={1}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim()}
          className="h-10 w-10 shrink-0"
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1 px-1">
        Press Enter to send, Shift+Enter for new line
      </p>
    </form>
  );
}
