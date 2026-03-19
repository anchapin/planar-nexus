'use client';

import { useEffect, useRef } from 'react';
import { Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/types/chat';

interface ChatMessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  className?: string;
}

function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function ChatMessageList({ messages, isLoading, className }: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle scroll to determine if user is at bottom
  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
    }
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
      className={cn('flex-1 overflow-y-auto p-4 space-y-4', className)}
    >
      {messages.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-8">
          <Bot className="w-12 h-12 mb-3 opacity-20" />
          <p className="text-sm max-w-[250px]">
            Ask me anything about your deck, card choices, or game strategy!
          </p>
        </div>
      )}

      {messages.map((message) => {
        const isUser = message.role === 'user';
        
        return (
          <div
            key={message.id}
            className={cn(
              'flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300',
              isUser ? 'justify-end' : 'justify-start'
            )}
          >
            {!isUser && (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
            )}
            
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2 shadow-sm',
                isUser 
                  ? 'bg-primary text-primary-foreground rounded-tr-none' 
                  : 'bg-muted rounded-tl-none'
              )}
            >
              <div className="whitespace-pre-wrap leading-relaxed text-sm">
                {message.content}
              </div>
              <div 
                className={cn(
                  'text-[10px] mt-1 opacity-60',
                  isUser ? 'text-primary-foreground' : 'text-muted-foreground'
                )}
              >
                {formatTimestamp(message.timestamp)}
              </div>
            </div>

            {isUser && (
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-primary-foreground" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
