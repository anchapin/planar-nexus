'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ChatMessage, ChatMessageRole } from '@/types/chat';
import { DeckCard } from '@/ai/flows/context-builder';
import { aiWorkerClient } from '@/ai/worker/ai-worker-client';
import type { DigestedCoachContext } from '@/ai/worker/worker-types';

const BASE_STORAGE_KEY = 'deck-coach-chat-history';

function getStorageKey(deckId?: string): string {
  if (!deckId) return BASE_STORAGE_KEY;
  return `${BASE_STORAGE_KEY}-${deckId}`;
}

function loadFromStorage(deckId?: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = getStorageKey(deckId);
    const stored = localStorage.getItem(key);
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

function saveToStorage(messages: ChatMessage[], deckId?: string) {
  if (typeof window === 'undefined') return;
  try {
    const key = getStorageKey(deckId);
    localStorage.setItem(key, JSON.stringify(messages));
  } catch (e) {
    console.error('Failed to save chat history:', e);
  }
}

export interface UseDeckCoachChatOptions {
  initialMessages?: ChatMessage[];
  deckCards?: DeckCard[];
  format?: string;
  archetype?: string;
  strategy?: string;
  deckId?: string; // Add deckId for isolation
}

export interface UseDeckCoachChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (content: string, options?: ChatRequestOptions) => Promise<void>;
  addAssistantMessage: (content: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
}

export interface ChatRequestOptions {
  deckCards?: DeckCard[];
  format?: string;
  archetype?: string;
  strategy?: string;
  gameState?: any;
  playerId?: string;
}

export function useDeckCoachChat(options: UseDeckCoachChatOptions = {}): UseDeckCoachChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesRef = useRef(messages);
  const deckIdRef = useRef(options.deckId);

  // Load messages when deckId changes
  useEffect(() => {
    const stored = loadFromStorage(options.deckId);
    setMessages(stored.length > 0 ? stored : options.initialMessages ?? []);
    deckIdRef.current = options.deckId;
  }, [options.deckId, options.initialMessages]);

  // Keep ref in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Persist to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      saveToStorage(messages, deckIdRef.current);
    }
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

  const addAssistantMessage = useCallback((content: string) => {
    addMessage(content, 'assistant');
  }, [addMessage]);

  const sendMessage = useCallback(async (content: string, chatOptions: ChatRequestOptions = {}) => {
    // 1. Add user message
    addMessage(content, 'user');
    
    // 2. Prepare for assistant response
    setIsLoading(true);
    
    // Create a placeholder for the assistant message that we'll stream into
    const assistantMsgId = crypto.randomUUID();
    const initialAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };
    
    setMessages((prev) => [...prev, initialAssistantMsg]);

    try {
      const currentDeckCards = chatOptions.deckCards || options.deckCards || [];
      const currentFormat = chatOptions.format || options.format || 'commander';
      const currentArchetype = chatOptions.archetype || options.archetype;
      const currentStrategy = chatOptions.strategy || options.strategy;

      // Payload reduction: if the deck is large, use digested context
      let digestedContext: DigestedCoachContext | undefined;
      let payloadDeck: DeckCard[] | undefined = currentDeckCards;

      if (currentDeckCards.length > 20 || chatOptions.gameState) {
        try {
          const api = aiWorkerClient.api;
          if (api) {
            digestedContext = await api.prepareCoachContext({
              deck: currentDeckCards,
              gameState: chatOptions.gameState,
              playerId: chatOptions.playerId
            });
            
            // If we have a successful digest, we can omit the full deck cards to save bandwidth
            if (digestedContext) {
              payloadDeck = undefined;
            }
          }
        } catch (error) {
          console.error('Context digestion failed, falling back to full payload:', error);
        }
      }

      const response = await fetch('/api/chat/coach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Filter out the empty assistant message we just added
          messages: messagesRef.current.filter(m => m.id !== assistantMsgId),
          deckCards: payloadDeck,
          digestedContext,
          format: currentFormat,
          archetype: currentArchetype,
          strategy: currentStrategy,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantContent += chunk;

        // Update the assistant message in real-time
        setMessages((prev) => 
          prev.map((msg) => 
            msg.id === assistantMsgId 
              ? { ...msg, content: assistantContent } 
              : msg
          )
        );
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === assistantMsgId 
            ? { ...msg, content: 'Sorry, I encountered an error. Please try again.' } 
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [addMessage, options.deckCards, options.format, options.archetype, options.strategy]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(getStorageKey(deckIdRef.current));
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

