'use client';

import { useState, useCallback } from 'react';
// Type-only import: the emote picker module itself is loaded on demand by
// the game-board route (issue #2946), so this statement must not pull it
// into the first-load payload.
import type { EmoteType, EmoteMessage } from '@/components/emote-picker';

interface UseGameEmotesOptions {
  currentPlayerId: string;
  currentPlayerName: string;
  maxEmotes?: number;
}

interface UseGameEmotesReturn {
  emotes: EmoteMessage[];
  sendEmote: (emote: EmoteType) => void;
  clearEmotes: () => void;
}

/**
 * Hook for managing game emote state
 */
export function useGameEmotes({
  currentPlayerId,
  currentPlayerName,
  maxEmotes = 50,
}: UseGameEmotesOptions): UseGameEmotesReturn {
  const [emotes, setEmotes] = useState<EmoteMessage[]>([]);

  const sendEmote = useCallback((emote: EmoteType) => {
    const newEmote: EmoteMessage = {
      id: `emote-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      playerId: currentPlayerId,
      playerName: currentPlayerName,
      emote,
      timestamp: Date.now(),
    };

    setEmotes((prev) => {
      const updated = [...prev, newEmote];
      // Limit emotes history
      if (updated.length > maxEmotes) {
        return updated.slice(-maxEmotes);
      }
      return updated;
    });
  }, [currentPlayerId, currentPlayerName, maxEmotes]);

  const clearEmotes = useCallback(() => {
    setEmotes([]);
  }, []);

  return {
    emotes,
    sendEmote,
    clearEmotes,
  };
}
