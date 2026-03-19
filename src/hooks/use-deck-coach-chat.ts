'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ChatMessage, ChatMessageRole } from '@/types/chat';

const STORAGE_KEY = 'deck-coach-chat-history';

function loadFromStorage(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((m: ChatMessage) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    }
  } catch (e) {
    console.error('Failed to load chat history:', e);
  }
  return [];
}

function saveToStorage(messages: ChatMessage[]) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch (e) {
    console.error('Failed to save chat history:', e);
  }
}

export interface UseDeckCoachChatOptions {
  initialMessages?: ChatMessage[];
}

export interface UseDeckCoachChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (content: string) => void;
  addAssistantMessage: (content: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
}

export function useDeckCoachChat(options: UseDeckCoachChatOptions = {}): UseDeckCoachChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const stored = loadFromStorage();
    return stored.length > 0 ? stored : options.initialMessages ?? [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const messagesRef = useRef(messages);

  // Keep ref in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Persist to sessionStorage
  useEffect(() => {
    saveToStorage(messages);
  }, [messages]);

  const addMessage = useCallback((content: string, role: ChatMessageRole) => {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  }, []);

  const sendMessage = useCallback((content: string) => {
    addMessage(content, 'user');
  }, [addMessage]);

  const addAssistantMessage = useCallback((content: string) => {
    addMessage(content, 'assistant');
  }, [addMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    addAssistantMessage,
    clearMessages,
    setLoading: setIsLoading,
  };
}
