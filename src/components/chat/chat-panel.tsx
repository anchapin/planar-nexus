'use client';

import { useRef, useEffect } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatMessageList } from './chat-message-list';
import { ChatInput } from './chat-input';
import { TypingIndicator } from './typing-indicator';
import type { ChatMessage } from '@/types/chat';

interface DeckCoachChatPanelProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  onSendMessage: (content: string) => void;
  className?: string;
}

export function DeckCoachChatPanel({
  messages,
  isLoading = false,
  onSendMessage,
  className,
}: DeckCoachChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or loading state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div className={cn('flex flex-col h-[500px] border rounded-lg bg-card shadow-sm', className)}>
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b bg-muted/20">
        <Bot className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-sm">AI Coach Chat</h3>
        <div className="ml-auto flex items-center gap-2">
          {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {isLoading ? 'Thinking...' : 'Ready'}
          </span>
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
