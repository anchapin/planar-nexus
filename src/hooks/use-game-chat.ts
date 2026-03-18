'use client';

import { useChat } from 'ai/react';
import { playerHistoryTool } from '@/ai/tools/player-history-client';
import { useState, useCallback, useMemo } from 'react';

interface UseGameChatOptions {
  currentPlayerId: string;
  currentPlayerName: string;
  initialMessages?: any[];
}

/**
 * Hook for managing game chat and AI coach interactions.
 * Uses Vercel AI SDK for streaming and tool support.
 * Includes compatibility layer for legacy game-chat components.
 */
export function useGameChat({ 
  currentPlayerId, 
  currentPlayerName,
  initialMessages = []
}: UseGameChatOptions) {
  const [unreadCount, setUnreadCount] = useState(0);

  const chat = useChat({
    api: '/api/chat',
    initialMessages,
    body: {
      userId: currentPlayerId,
      userName: currentPlayerName,
    },
    tools: {
      getPlayerHistory: playerHistoryTool,
    },
    maxSteps: 5,
    onResponse: (response) => {
      if (!response.ok) {
        console.error('Chat error:', response.statusText);
      }
    },
    onFinish: () => {
      // Increment unread if chat isn't focused (generic logic)
      setUnreadCount(prev => prev + 1);
    },
    onError: (error) => {
      console.error('Chat hook error:', error);
    },
  });

  // Compatibility: Map AI SDK messages to ChatMessage format
  const legacyMessages = useMemo(() => {
    return chat.messages.map(m => ({
      id: m.id,
      playerId: m.role === 'user' ? currentPlayerId : 'ai-coach',
      playerName: m.role === 'user' ? currentPlayerName : 'AI Coach',
      content: m.content,
      timestamp: m.createdAt ? m.createdAt.getTime() : Date.now(),
      isSystem: m.role === 'system',
      toolInvocations: m.toolInvocations,
    }));
  }, [chat.messages, currentPlayerId, currentPlayerName]);

  // Compatibility: Legacy methods
  const sendMessage = useCallback((content: string) => {
    chat.append({ role: 'user', content });
  }, [chat.append]);

  const clearMessages = useCallback(() => {
    chat.setMessages([]);
  }, [chat.setMessages]);

  const markAsRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  return {
    ...chat,
    messages: chat.messages, // AI SDK format
    legacyMessages,          // ChatMessage format
    sendMessage,
    clearMessages,
    unreadCount,
    markAsRead,
    currentPlayerId,
    currentPlayerName,
  };
}
