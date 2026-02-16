'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, MessageCircle, X, Minimize2, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  content: string;
  timestamp: number;
  isSystem?: boolean;
}

interface GameChatProps {
  messages: ChatMessage[];
  currentPlayerId: string;
  currentPlayerName: string;
  onSendMessage: (content: string) => void;
  className?: string;
}

export function GameChat({
  messages,
  currentPlayerId,
  currentPlayerName,
  onSendMessage,
  className,
}: GameChatProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const content = inputValue.trim();
    if (!content) return;

    onSendMessage(content);
    setInputValue('');
    inputRef.current?.focus();
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getPlayerInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  // Generate a consistent color based on player name
  const getPlayerColor = (playerId: string) => {
    const colors = [
      'bg-red-500',
      'bg-blue-500',
      'bg-green-500',
      'bg-yellow-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-orange-500',
      'bg-teal-500',
    ];
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
      hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div
      className={cn(
        'flex flex-col bg-card border rounded-lg shadow-lg transition-all duration-300',
        isMinimized ? 'h-12' : 'h-80',
        className
      )}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 rounded-t-lg cursor-pointer"
        onClick={() => setIsMinimized(!isMinimized)}
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4" />
          <span className="font-semibold text-sm">Chat</span>
          {messages.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({messages.length})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsMinimized(!isMinimized)}
          >
            {isMinimized ? (
              <Maximize2 className="w-3 h-3" />
            ) : (
              <Minimize2 className="w-3 h-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsOpen(false)}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Chat content */}
      {isOpen && !isMinimized && (
        <>
          {/* Messages */}
          <ScrollArea className="flex-1 px-3 py-2">
            <div ref={scrollRef} className="space-y-3">
              {messages.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No messages yet. Say hello!
                </p>
              ) : (
                messages.map((message) => {
                  const isOwnMessage = message.playerId === currentPlayerId;
                  const isSystemMessage = message.isSystem;

                  if (isSystemMessage) {
                    return (
                      <div key={message.id} className="text-center">
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                          {message.content}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={message.id}
                      className={cn(
                        'flex gap-2',
                        isOwnMessage ? 'flex-row-reverse' : 'flex-row'
                      )}
                    >
                      {/* Player avatar */}
                      <div
                        className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0',
                          getPlayerColor(message.playerId)
                        )}
                        title={message.playerName}
                      >
                        {getPlayerInitial(message.playerName)}
                      </div>

                      {/* Message bubble */}
                      <div
                        className={cn(
                          'max-w-[75%] rounded-lg px-3 py-1.5',
                          isOwnMessage
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        )}
                      >
                        {!isOwnMessage && (
                          <div className="text-xs font-semibold text-muted-foreground mb-0.5">
                            {message.playerName}
                          </div>
                        )}
                        <div className="text-sm break-words">{message.content}</div>
                        <div
                          className={cn(
                            'text-[10px] mt-0.5',
                            isOwnMessage
                              ? 'text-primary-foreground/70'
                              : 'text-muted-foreground'
                          )}
                        >
                          {formatTime(message.timestamp)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-3 border-t">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type a message..."
                className="flex-1"
                maxLength={500}
              />
              <Button type="submit" size="icon" disabled={!inputValue.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

// Chat toggle button for when chat is closed
interface ChatToggleProps {
  unreadCount?: number;
  onClick: () => void;
}

export function ChatToggle({ unreadCount = 0, onClick }: ChatToggleProps) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="relative"
      onClick={onClick}
    >
      <MessageCircle className="w-4 h-4" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Button>
  );
}
