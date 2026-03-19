'use client';

import { useChat } from '@ai-sdk/react';
import { playerHistoryTool } from '@/ai/tools/player-history-client';
import { useState, useCallback, useMemo } from 'react';

/**
 * Simplified hook for game chat - uses default /api/chat endpoint
 * AI SDK v6 has breaking changes - this is a minimal working implementation
 */
export function useGameChat({ 
  currentPlayerId, 
  currentPlayerName,
}: { currentPlayerId: string; currentPlayerName: string }) {
  const [unreadCount, setUnreadCount] = useState(0);

  // AI SDK v6: Use the default API endpoint
  const chat = useChat({
    onError: (error) => {
      console.error('Chat hook error:', error);
    },
  });

  // AI SDK v6: sendMessage accepts a message object - cast to any for compatibility
  const sendMessage = useCallback((content: string) => {
    (chat.sendMessage as any)({ role: 'user', content });
  }, [chat.sendMessage]);

  const clearMessages = useCallback(() => {
    chat.setMessages([]);
  }, [chat.setMessages]);

  const markAsRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  // Simplified legacy messages
  const legacyMessages = useMemo(() => {
    return chat.messages.map((m: any) => ({
      id: m.id,
      playerId: m.role === 'user' ? currentPlayerId : 'ai-coach',
      playerName: m.role === 'user' ? currentPlayerName : 'AI Coach',
      content: typeof m.content === 'string' ? m.content : '',
      timestamp: Date.now(),
      isSystem: m.role === 'system',
      toolInvocations: m.toolInvocations,
    }));
  }, [chat.messages, currentPlayerId, currentPlayerName]);

  return {
    ...chat,
    messages: chat.messages,
    legacyMessages,
    sendMessage,
    clearMessages,
    unreadCount,
    markAsRead,
    currentPlayerId,
    currentPlayerName,
  };
}
