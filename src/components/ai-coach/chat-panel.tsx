'use client';

import { useRef, useEffect, useState } from 'react';
import { useGameChat } from '@/hooks/use-game-chat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, User, Send, Loader2, History, Database } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AICoachChatPanelProps {
  currentPlayerId: string;
  currentPlayerName: string;
  className?: string;
}

export function AICoachChatPanel({
  currentPlayerId,
  currentPlayerName,
  className,
}: AICoachChatPanelProps) {
  const {
    messages,
    status,
    sendMessage,
  } = useGameChat({
    currentPlayerId,
    currentPlayerName,
  });

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const isThinking = status === 'submitted' || status === 'streaming';
  const isLoading = status === 'submitted' || status === 'streaming';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      sendMessage(input);
      setInput('');
    }
  };

  // Helper to extract text content from AI SDK v6 message
  const getMessageContent = (message: any): string => {
    if (!message.content) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join('');
    }
    return '';
  };

  return (
    <div className={cn('flex flex-col h-[500px] border rounded-lg bg-card shadow-sm', className)}>
      <div className="flex items-center gap-2 p-3 border-b bg-muted/20">
        <Bot className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-sm">AI Coach</h3>
        <div className="ml-auto flex items-center gap-2">
          {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {status === 'ready' ? 'Ready' : status}
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div ref={scrollRef} className="space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Ask me anything about your deck, game history, or card rules!</p>
            </div>
          )}

          {messages.map((message: any) => {
            const isAI = message.role === 'assistant';
            const content = getMessageContent(message);
            return (
              <div
                key={message.id}
                className={cn(
                  'flex gap-3 text-sm',
                  isAI ? 'justify-start' : 'justify-end'
                )}
              >
                {isAI && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-2 shadow-sm',
                    isAI 
                      ? 'bg-muted rounded-tl-none' 
                      : 'bg-primary text-primary-foreground rounded-tr-none'
                  )}
                >
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {content}
                  </div>
                  
                  {/* Handle tool calls/invocations if present in message */}
                  {message.toolInvocations && message.toolInvocations.length > 0 && (
                    <div className="mt-2 space-y-2 border-t pt-2 border-border/50">
                      {message.toolInvocations.map((tool: any) => (
                        <div key={tool.toolCallId} className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                          {tool.toolName === 'searchCards' ? <Database className="w-3 h-3" /> : <History className="w-3 h-3" />}
                          <span>EXECUTING: {tool.toolName}</span>
                          {'result' in tool && <span className="text-green-500">✓ DONE</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {!isAI && (
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-primary-foreground" />
                  </div>
                )}
              </div>
            );
          })}
          
          {isThinking && (
            <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-none px-4 py-2 flex gap-1 items-center h-9">
                <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"></span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="p-3 border-t bg-muted/5">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="How can I improve my win rate?"
            className="flex-1 h-10 shadow-none border-none focus-visible:ring-1"
            disabled={isLoading}
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={isLoading || !input.trim()}
            className="h-10 w-10 shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
