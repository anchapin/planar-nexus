/**
 * AI Neighbor Hook
 * 
 * Provides automated AI pick functionality for draft mode.
 * NEIB-04: AI picks automatically after configurable delay
 */

"use client";

import { useCallback, useEffect, useRef } from 'react';
import type { DraftSession } from '@/lib/limited/types';
import { selectAiPick, pickRandomCard } from '@/lib/ai-neighbor-logic';
import { passPack, isAiPickTurn } from '@/lib/limited/draft-generator';

export interface UseAiNeighborOptions {
  /** Callback when AI makes a pick */
  onAiPick?: (session: DraftSession) => void;
  /** Callback when pack should pass back to user */
  onPackReturned?: () => void;
}

export interface UseAiNeighborReturn {
  /** Is AI currently picking */
  isAiPicking: boolean;
  /** Trigger AI to pick now */
  triggerAiPick: () => void;
  /** Cancel any pending AI pick */
  cancelAiPick: () => void;
}

/**
 * Hook for managing AI neighbor picks in draft mode
 * 
 * Automatically triggers AI picks when it's the AI's turn,
 * with configurable delay to simulate "thinking"
 */
export function useAiNeighbor(
  session: DraftSession | null,
  setSession: (session: DraftSession) => void,
  options: UseAiNeighborOptions = {}
): UseAiNeighborReturn {
  const { onAiPick, onPackReturned } = options;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAiPickingRef = useRef(false);
  
  /**
   * Main AI pick function - selects a card and updates the session
   */
  const triggerAiPick = useCallback(() => {
    if (!session || !session.aiNeighbor?.enabled) return;
    if (!isAiPickTurn(session)) return;
    
    // Get current pack
    const currentPack = session.packs[session.currentPackIndex];
    if (!currentPack || currentPack.pickedCardIds.length >= currentPack.cards.length) {
      return; // Pack empty
    }
    
    // Mark AI as picking
    isAiPickingRef.current = true;
    setSession({
      ...session,
      aiNeighbor: {
        ...session.aiNeighbor,
        state: {
          ...session.aiNeighbor.state,
          isPicking: true,
          pickStartTime: Date.now(),
        },
      },
    });
    
    // Delay before AI picks (simulates "thinking")
    const delay = session.aiNeighbor.pickDelay || 2000;
    
    timeoutRef.current = setTimeout(() => {
      if (!session || !session.aiNeighbor) return;
      
      // Select card for AI to pick
      const pickedCard = selectAiPick(currentPack, session.aiNeighbor);
      
      if (pickedCard) {
        // Add card to AI's pool
        const updatedSession: DraftSession = {
          ...session,
          aiNeighbor: {
            ...session.aiNeighbor,
            state: {
              ...session.aiNeighbor.state,
              pool: [...session.aiNeighbor.state.pool, pickedCard],
              isPicking: false,
              pickStartTime: null,
            },
          },
        };
        
        // Mark card as picked in pack
        const updatedPacks = [...session.packs];
        updatedPacks[session.currentPackIndex] = {
          ...currentPack,
          pickedCardIds: [...currentPack.pickedCardIds, pickedCard.id],
        };
        
        const finalSession: DraftSession = {
          ...updatedSession,
          packs: updatedPacks,
        };
        
        setSession(finalSession);
        onAiPick?.(finalSession);
        
        // Pass pack back to user
        const passedSession = passPack(finalSession);
        setSession(passedSession);
        onPackReturned?.();
      }
      
      isAiPickingRef.current = false;
    }, delay);
  }, [session, setSession, onAiPick, onPackReturned]);
  
  /**
   * Cancel any pending AI pick
   */
  const cancelAiPick = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    isAiPickingRef.current = false;
  }, []);
  
  /**
   * Auto-trigger AI pick when it's AI's turn
   */
  useEffect(() => {
    if (!session || !session.aiNeighbor?.enabled) return;
    
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Check if it's AI's turn
    if (isAiPickTurn(session)) {
      // Get current pack
      const currentPack = session.packs[session.currentPackIndex];
      
      // Only trigger if pack has cards left
      if (currentPack && currentPack.pickedCardIds.length < currentPack.cards.length) {
        // Small delay before AI starts thinking
        timeoutRef.current = setTimeout(() => {
          triggerAiPick();
        }, 500);
      }
    }
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [session?.currentPackHolder, triggerAiPick, session]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
  
  return {
    isAiPicking: isAiPickingRef.current,
    triggerAiPick,
    cancelAiPick,
  };
}
