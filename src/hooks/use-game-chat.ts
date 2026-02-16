'use client';

import { useState, useCallback } from 'react';
import { ChatMessage } from '@/components/game-chat';

interface UseGameChatOptions {
  currentPlayerId: string;
  currentPlayerName: string;
  maxMessages?: number;
}

interface UseGameChatReturn {
  messages: ChatMessage[];
  sendMessage: (content: string) => void;
  addSystemMessage: (content: string) => void;
  clearMessages: () => void;
  unreadCount: number;
  markAsRead: () => void;
}

/**
 * Hook for managing game chat state
 */
export function useGameChat({ 
  currentPlayerId, 
  currentPlayerName,
  maxMessages = 100 
}: UseGameChatOptions): UseGameChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const sendMessage = useCallback((content: string) => {
    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      playerId: currentPlayerId,
      playerName: currentPlayerName,
      content: content.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => {
      const updated = [...prev, newMessage];
      // Limit message history
      if (updated.length > maxMessages) {
        return updated.slice(-maxMessages);
      }
      return updated;
    });
  }, [currentPlayerId, currentPlayerName, maxMessages]);

  const addSystemMessage = useCallback((content: string) => {
    const systemMessage: ChatMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      playerId: 'system',
      playerName: 'System',
      content,
      timestamp: Date.now(),
      isSystem: true,
    };

    setMessages((prev) => {
      const updated = [...prev, systemMessage];
      if (updated.length > maxMessages) {
        return updated.slice(-maxMessages);
      }
      return updated;
    });
  }, [maxMessages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setUnreadCount(0);
  }, []);

  const markAsRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  return {
    messages,
    sendMessage,
    addSystemMessage,
    clearMessages,
    unreadCount,
    markAsRead,
  };
}
