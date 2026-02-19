/**
 * useTrading Hook
 * Issue #292: Add trading system for card exchange
 * 
 * React hook for managing card trading between players.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  tradeManager,
  type TradeOffer,
  type TradeCardItem,
  type TradeStatus,
  type TradeNotification,
  calculateTradeFairness,
} from '@/lib/trading';
import type { ScryfallCard } from '@/app/actions';

/**
 * Hook state
 */
export interface UseTradingState {
  /** Active trades */
  activeTrades: TradeOffer[];
  /** Pending trades (incoming/outgoing) */
  pendingTrades: TradeOffer[];
  /** Trade history */
  tradeHistory: TradeOffer[];
  /** Current trade being viewed/edited */
  currentTrade: TradeOffer | null;
  /** Notifications */
  notifications: TradeNotification[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
}

/**
 * Hook return type
 */
export interface UseTradingReturn extends UseTradingState {
  /** Create a new trade offer */
  createTrade: (recipientId: string, recipientName: string) => TradeOffer;
  /** Add cards to offer */
  addCardsToOffer: (cards: TradeCardItem[]) => void;
  /** Add cards to want list */
  addCardsToWant: (cards: TradeCardItem[]) => void;
  /** Remove card from offer */
  removeCardFromOffer: (cardId: string) => void;
  /** Remove card from want list */
  removeCardFromWant: (cardId: string) => void;
  /** Submit trade offer */
  submitTrade: () => void;
  /** Accept trade */
  acceptTrade: (tradeId: string) => void;
  /** Reject trade */
  rejectTrade: (tradeId: string) => void;
  /** Counter offer */
  counterOffer: (tradeId: string) => void;
  /** Cancel trade */
  cancelTrade: (tradeId: string) => void;
  /** Select a trade to view/edit */
  selectTrade: (tradeId: string) => void;
  /** Clear current trade */
  clearCurrentTrade: () => void;
  /** Clear notifications */
  clearNotifications: () => void;
  /** Get trade fairness score */
  getTradeFairness: (tradeId: string) => { score: number; assessment: string };
  /** Add notes to trade */
  addNotes: (notes: string) => void;
}

/**
 * Hook options
 */
export interface UseTradingOptions {
  /** Current player ID */
  playerId: string;
  /** Current player name */
  playerName: string;
  /** Auto-refresh interval (ms) */
  refreshInterval?: number;
}

/**
 * React hook for managing card trading
 */
export function useTrading(options: UseTradingOptions): UseTradingReturn {
  const { playerId, playerName, refreshInterval = 5000 } = options;

  const [state, setState] = useState<UseTradingState>({
    activeTrades: [],
    pendingTrades: [],
    tradeHistory: [],
    currentTrade: null,
    notifications: [],
    isLoading: false,
    error: null,
  });

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load trades on mount and set up refresh interval
  useEffect(() => {
    refreshTrades();

    if (refreshInterval > 0) {
      refreshIntervalRef.current = setInterval(refreshTrades, refreshInterval);
    }

    // Subscribe to trade notifications
    const unsubscribe = tradeManager.subscribe((notification) => {
      setState((prev) => ({
        ...prev,
        notifications: [...prev.notifications, notification],
      }));
      refreshTrades();
    });

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      unsubscribe();
    };
  }, [playerId]);

  /**
   * Refresh trades from storage
   */
  const refreshTrades = useCallback(() => {
    try {
      const allTrades = tradeManager.getTradesForPlayer(playerId);
      const pending = allTrades.filter(
        (t) => t.status === 'pending' || t.status === 'countered' || t.status === 'draft'
      );
      const active = allTrades.filter(
        (t) => t.status === 'accepted' && !t.completedAt
      );
      const history = allTrades.filter(
        (t) => t.status === 'completed' || t.status === 'rejected' || t.status === 'cancelled'
      );

      setState((prev) => ({
        ...prev,
        activeTrades: active,
        pendingTrades: pending,
        tradeHistory: history,
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error : new Error(String(error)),
        isLoading: false,
      }));
    }
  }, [playerId]);

  /**
   * Create a new trade offer
   */
  const createTrade = useCallback(
    (recipientId: string, recipientName: string): TradeOffer => {
      const trade = tradeManager.createTradeOffer(
        playerId,
        playerName,
        recipientId,
        recipientName
      );

      setState((prev) => ({
        ...prev,
        currentTrade: trade,
        pendingTrades: [...prev.pendingTrades, trade],
      }));

      return trade;
    },
    [playerId, playerName]
  );

  /**
   * Add cards to current trade offer
   */
  const addCardsToOffer = useCallback((cards: TradeCardItem[]) => {
    setState((prev) => {
      if (!prev.currentTrade) return prev;

      const updatedTrade = tradeManager.addCardsToOffer(
        prev.currentTrade.id,
        playerId,
        cards
      );

      return {
        ...prev,
        currentTrade: updatedTrade,
        pendingTrades: prev.pendingTrades.map((t) =>
          t.id === updatedTrade?.id ? updatedTrade : t
        ),
      };
    });
  }, [playerId]);

  /**
   * Add cards to want list
   */
  const addCardsToWant = useCallback((cards: TradeCardItem[]) => {
    setState((prev) => {
      if (!prev.currentTrade) return prev;

      const updatedTrade = tradeManager.addWantedCards(
        prev.currentTrade.id,
        playerId,
        cards
      );

      return {
        ...prev,
        currentTrade: updatedTrade,
        pendingTrades: prev.pendingTrades.map((t) =>
          t.id === updatedTrade?.id ? updatedTrade : t
        ),
      };
    });
  }, [playerId]);

  /**
   * Remove card from offer
   */
  const removeCardFromOffer = useCallback((cardId: string) => {
    setState((prev) => {
      if (!prev.currentTrade) return prev;

      const updatedTrade = tradeManager.removeCardFromOffer(
        prev.currentTrade.id,
        playerId,
        cardId
      );

      return {
        ...prev,
        currentTrade: updatedTrade,
        pendingTrades: prev.pendingTrades.map((t) =>
          t.id === updatedTrade?.id ? updatedTrade : t
        ),
      };
    });
  }, [playerId]);

  /**
   * Remove card from want list
   */
  const removeCardFromWant = useCallback((cardId: string) => {
    setState((prev) => {
      if (!prev.currentTrade) return prev;

      // This would need to be added to the tradeManager
      // For now, we'll update the state directly
      const updatedTrade = { ...prev.currentTrade };
      const partyIndex = updatedTrade.parties.findIndex((p) => p.id === playerId);
      if (partyIndex >= 0) {
        updatedTrade.parties[partyIndex].wantedCards = updatedTrade.parties[
          partyIndex
        ].wantedCards.filter((c) => c.card.id !== cardId);
      }

      return {
        ...prev,
        currentTrade: updatedTrade,
        pendingTrades: prev.pendingTrades.map((t) =>
          t.id === updatedTrade.id ? updatedTrade : t
        ),
      };
    });
  }, [playerId]);

  /**
   * Submit trade offer
   */
  const submitTrade = useCallback(() => {
    setState((prev) => {
      if (!prev.currentTrade) return prev;

      const updatedTrade = tradeManager.submitTradeOffer(
        prev.currentTrade.id,
        playerId
      );

      return {
        ...prev,
        currentTrade: updatedTrade,
        pendingTrades: prev.pendingTrades.map((t) =>
          t.id === updatedTrade?.id ? updatedTrade : t
        ),
      };
    });
  }, [playerId]);

  /**
   * Accept trade
   */
  const acceptTrade = useCallback((tradeId: string) => {
    const updatedTrade = tradeManager.acceptTrade(tradeId, playerId);

    setState((prev) => {
      if (updatedTrade?.status === 'accepted' && updatedTrade.completedAt) {
        // Trade completed - move to history
        return {
          ...prev,
          currentTrade: prev.currentTrade?.id === tradeId ? null : prev.currentTrade,
          pendingTrades: prev.pendingTrades.filter((t) => t.id !== tradeId),
          tradeHistory: [...prev.tradeHistory, updatedTrade],
        };
      }

      return {
        ...prev,
        pendingTrades: prev.pendingTrades.map((t) =>
          t.id === updatedTrade?.id ? updatedTrade : t
        ),
      };
    });
  }, [playerId]);

  /**
   * Reject trade
   */
  const rejectTrade = useCallback((tradeId: string) => {
    const updatedTrade = tradeManager.rejectTrade(tradeId, playerId);

    setState((prev) => ({
      ...prev,
      currentTrade: prev.currentTrade?.id === tradeId ? null : prev.currentTrade,
      pendingTrades: prev.pendingTrades.filter((t) => t.id !== tradeId),
      tradeHistory: updatedTrade ? [...prev.tradeHistory, updatedTrade] : prev.tradeHistory,
    }));
  }, [playerId]);

  /**
   * Counter offer
   */
  const counterOffer = useCallback((tradeId: string) => {
    const updatedTrade = tradeManager.counterOffer(tradeId, playerId);

    setState((prev) => ({
      ...prev,
      currentTrade: updatedTrade,
      pendingTrades: prev.pendingTrades.map((t) =>
        t.id === updatedTrade?.id ? updatedTrade : t
      ),
    }));
  }, [playerId]);

  /**
   * Cancel trade
   */
  const cancelTrade = useCallback((tradeId: string) => {
    const updatedTrade = tradeManager.cancelTrade(tradeId, playerId);

    setState((prev) => ({
      ...prev,
      currentTrade: prev.currentTrade?.id === tradeId ? null : prev.currentTrade,
      pendingTrades: prev.pendingTrades.filter((t) => t.id !== tradeId),
      tradeHistory: updatedTrade ? [...prev.tradeHistory, updatedTrade] : prev.tradeHistory,
    }));
  }, [playerId]);

  /**
   * Select a trade to view/edit
   */
  const selectTrade = useCallback((tradeId: string) => {
    const trade = tradeManager.getTradeOffer(tradeId);
    setState((prev) => ({
      ...prev,
      currentTrade: trade,
    }));
  }, []);

  /**
   * Clear current trade
   */
  const clearCurrentTrade = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentTrade: null,
    }));
  }, []);

  /**
   * Clear notifications
   */
  const clearNotifications = useCallback(() => {
    setState((prev) => ({
      ...prev,
      notifications: [],
    }));
  }, []);

  /**
   * Get trade fairness score
   */
  const getTradeFairness = useCallback((tradeId: string) => {
    const trade = tradeManager.getTradeOffer(tradeId);
    if (!trade) return { score: 0, assessment: 'Trade not found' };

    const myIndex = trade.parties.findIndex((p) => p.id === playerId);
    const otherIndex = myIndex === 0 ? 1 : 0;

    return calculateTradeFairness(
      trade.parties[myIndex].offeredCards,
      trade.parties[otherIndex].offeredCards
    );
  }, [playerId]);

  /**
   * Add notes to trade
   */
  const addNotes = useCallback((notes: string) => {
    setState((prev) => {
      if (!prev.currentTrade) return prev;

      const updatedTrade = tradeManager.addTradeNotes(
        prev.currentTrade.id,
        playerId,
        notes
      );

      return {
        ...prev,
        currentTrade: updatedTrade,
        pendingTrades: prev.pendingTrades.map((t) =>
          t.id === updatedTrade?.id ? updatedTrade : t
        ),
      };
    });
  }, [playerId]);

  return {
    ...state,
    createTrade,
    addCardsToOffer,
    addCardsToWant,
    removeCardFromOffer,
    removeCardFromWant,
    submitTrade,
    acceptTrade,
    rejectTrade,
    counterOffer,
    cancelTrade,
    selectTrade,
    clearCurrentTrade,
    clearNotifications,
    getTradeFairness,
    addNotes,
  };
}

export default useTrading;