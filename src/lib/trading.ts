/**
 * @fileOverview Card trading system for player-to-player card trades
 * 
 * Issue #95: Phase 5.3: Add trading system
 * 
 * Provides:
 * - Trade offer system
 * - Have/want lists
 * - Trade matching
 * - Trade chat
 * - Trade confirmation
 */

import type { ScryfallCard } from '@/app/actions';

/**
 * Trade status
 */
export type TradeStatus = 
  | 'draft'        // Trade is being created
  | 'pending'      // Trade offer sent, waiting for response
  | 'countered'   // Counter-offer made
  | 'accepted'    // Both parties accepted
  | 'rejected'    // One party rejected
  | 'cancelled'   // Trade was cancelled
  | 'completed';  // Trade was executed

/**
 * Trade party
 */
export interface TradeParty {
  id: string;
  name: string;
  offeredCards: TradeCardItem[];
  wantedCards: TradeCardItem[];
  status: 'pending' | 'accepted' | 'rejected';
  respondedAt?: number;
}

/**
 * Card item in a trade
 */
export interface TradeCardItem {
  card: ScryfallCard;
  quantity: number;
  condition?: 'mint' | 'near-mint' | 'good' | 'fair' | 'poor';
  notes?: string;
}

/**
 * Trade offer
 */
export interface TradeOffer {
  id: string;
  parties: [TradeParty, TradeParty]; // Exactly 2 parties
  status: TradeStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  notes?: string; // Trade notes/chat
}

/**
 * Trade history entry
 */
export interface TradeHistoryEntry {
  id: string;
  offerId: string;
  otherPartyName: string;
  cardsGiven: TradeCardItem[];
  cardsReceived: TradeCardItem[];
  completedAt: number;
}

/**
 * Trade notification
 */
export interface TradeNotification {
  type: 'new_offer' | 'counter_offer' | 'accepted' | 'rejected' | 'completed';
  tradeId: string;
  message: string;
  timestamp: number;
}

/**
 * Trade manager class
 */
class TradeManager {
  private storageKey = 'planar_nexus_trades';
  private historyKey = 'planar_nexus_trade_history';
  private listeners: Set<(notification: TradeNotification) => void> = new Set();

  /**
   * Create a new trade offer
   */
  createTradeOffer(
    initiatorId: string,
    initiatorName: string,
    recipientId: string,
    recipientName: string
  ): TradeOffer {
    const now = Date.now();
    
    const offer: TradeOffer = {
      id: `trade-${now}-${Math.random().toString(36).substr(2, 9)}`,
      parties: [
        {
          id: initiatorId,
          name: initiatorName,
          offeredCards: [],
          wantedCards: [],
          status: 'pending',
        },
        {
          id: recipientId,
          name: recipientName,
          offeredCards: [],
          wantedCards: [],
          status: 'pending',
        },
      ],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };

    this.saveTrade(offer);
    return offer;
  }

  /**
   * Add cards to a party's offer
   */
  addCardsToOffer(
    tradeId: string,
    partyId: string,
    cards: TradeCardItem[]
  ): TradeOffer | null {
    const offer = this.getTradeOffer(tradeId);
    if (!offer) return null;

    const partyIndex = offer.parties.findIndex(p => p.id === partyId);
    if (partyIndex === -1) return null;

    // Add cards to offered cards
    offer.parties[partyIndex].offeredCards = [
      ...offer.parties[partyIndex].offeredCards,
      ...cards,
    ];
    
    offer.updatedAt = Date.now();
    this.saveTrade(offer);
    return offer;
  }

  /**
   * Add cards to a party's want list
   */
  addWantedCards(
    tradeId: string,
    partyId: string,
    cards: TradeCardItem[]
  ): TradeOffer | null {
    const offer = this.getTradeOffer(tradeId);
    if (!offer) return null;

    const partyIndex = offer.parties.findIndex(p => p.id === partyId);
    if (partyIndex === -1) return null;

    offer.parties[partyIndex].wantedCards = [
      ...offer.parties[partyIndex].wantedCards,
      ...cards,
    ];
    
    offer.updatedAt = Date.now();
    this.saveTrade(offer);
    return offer;
  }

  /**
   * Remove a card from offer
   */
  removeCardFromOffer(
    tradeId: string,
    partyId: string,
    cardId: string
  ): TradeOffer | null {
    const offer = this.getTradeOffer(tradeId);
    if (!offer) return null;

    const partyIndex = offer.parties.findIndex(p => p.id === partyId);
    if (partyIndex === -1) return null;

    offer.parties[partyIndex].offeredCards = 
      offer.parties[partyIndex].offeredCards.filter(c => c.card.id !== cardId);
    
    offer.updatedAt = Date.now();
    this.saveTrade(offer);
    return offer;
  }

  /**
   * Send/submit the trade offer
   */
  submitTradeOffer(tradeId: string, partyId: string): TradeOffer | null {
    const offer = this.getTradeOffer(tradeId);
    if (!offer) return null;

    if (offer.status === 'draft') {
      offer.status = 'pending';
    }
    
    offer.updatedAt = Date.now();
    this.saveTrade(offer);
    
    this.notify({
      type: 'new_offer',
      tradeId,
      message: 'New trade offer received',
      timestamp: Date.now(),
    });
    
    return offer;
  }

  /**
   * Accept a trade offer
   */
  acceptTrade(tradeId: string, partyId: string): TradeOffer | null {
    const offer = this.getTradeOffer(tradeId);
    if (!offer) return null;

    const partyIndex = offer.parties.findIndex(p => p.id === partyId);
    if (partyIndex === -1) return null;

    // Mark this party as accepted
    offer.parties[partyIndex].status = 'accepted';
    offer.parties[partyIndex].respondedAt = Date.now();

    // Check if both parties have accepted
    const bothAccepted = offer.parties.every(p => p.status === 'accepted');
    
    if (bothAccepted) {
      offer.status = 'accepted';
      offer.completedAt = Date.now();
      
      // Add to history for both parties
      this.addToHistory(offer, partyId);
      this.addToHistory(offer, offer.parties.find(p => p.id !== partyId)?.id || '');
      
      this.notify({
        type: 'accepted',
        tradeId,
        message: 'Trade accepted by both parties',
        timestamp: Date.now(),
      });
    } else {
      this.notify({
        type: 'accepted',
        tradeId,
        message: `${offer.parties[partyIndex].name} accepted the trade`,
        timestamp: Date.now(),
      });
    }
    
    offer.updatedAt = Date.now();
    this.saveTrade(offer);
    return offer;
  }

  /**
   * Reject a trade offer
   */
  rejectTrade(tradeId: string, partyId: string): TradeOffer | null {
    const offer = this.getTradeOffer(tradeId);
    if (!offer) return null;

    const partyIndex = offer.parties.findIndex(p => p.id === partyId);
    if (partyIndex === -1) return null;

    offer.parties[partyIndex].status = 'rejected';
    offer.parties[partyIndex].respondedAt = Date.now();
    offer.status = 'rejected';
    offer.updatedAt = Date.now();
    
    this.saveTrade(offer);
    
    this.notify({
      type: 'rejected',
      tradeId,
      message: `${offer.parties[partyIndex].name} rejected the trade`,
      timestamp: Date.now(),
    });
    
    return offer;
  }

  /**
   * Make a counter-offer
   */
  counterOffer(tradeId: string, partyId: string): TradeOffer | null {
    const offer = this.getTradeOffer(tradeId);
    if (!offer) return null;

    // Reset both parties to pending
    offer.parties.forEach(p => {
      p.status = 'pending';
    });
    
    offer.status = 'countered';
    offer.updatedAt = Date.now();
    
    this.saveTrade(offer);
    
    this.notify({
      type: 'counter_offer',
      tradeId,
      message: 'Counter-offer made',
      timestamp: Date.now(),
    });
    
    return offer;
  }

  /**
   * Cancel a trade offer
   */
  cancelTrade(tradeId: string, partyId: string): TradeOffer | null {
    const offer = this.getTradeOffer(tradeId);
    if (!offer) return null;

    // Only initiator can cancel a draft/pending trade
    if (offer.parties[0].id !== partyId) return null;

    offer.status = 'cancelled';
    offer.updatedAt = Date.now();
    
    this.saveTrade(offer);
    return offer;
  }

  /**
   * Get all trades for a player
   */
  getTradesForPlayer(playerId: string): TradeOffer[] {
    const trades = this.getAllTrades();
    return trades.filter(trade => 
      trade.parties.some(p => p.id === playerId)
    );
  }

  /**
   * Get pending trades for a player
   */
  getPendingTrades(playerId: string): TradeOffer[] {
    return this.getTradesForPlayer(playerId).filter(
      t => t.status === 'pending' || t.status === 'countered' || t.status === 'draft'
    );
  }

  /**
   * Get trade history for a player
   */
  getTradeHistory(_playerId: string): TradeHistoryEntry[] {
    const history = this.getHistory();
    return history.filter(_h => {
      // This is simplified - in real app would track which user is which
      return true;
    });
  }

  /**
   * Get a specific trade offer
   */
  getTradeOffer(tradeId: string): TradeOffer | null {
    const trades = this.getAllTrades();
    return trades.find(t => t.id === tradeId) || null;
  }

  /**
   * Add notes/chat to trade
   */
  addTradeNotes(tradeId: string, partyId: string, notes: string): TradeOffer | null {
    const offer = this.getTradeOffer(tradeId);
    if (!offer) return null;

    const existingNotes = offer.notes || '';
    const partyName = offer.parties.find(p => p.id === partyId)?.name || 'Unknown';
    
    offer.notes = existingNotes + `\n${partyName}: ${notes}`;
    offer.updatedAt = Date.now();
    
    this.saveTrade(offer);
    return offer;
  }

  /**
   * Subscribe to trade notifications
   */
  subscribe(listener: (notification: TradeNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get all trades (local storage)
   */
  private getAllTrades(): TradeOffer[] {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(this.storageKey);
    return stored ? JSON.parse(stored) : [];
  }

  /**
   * Save a trade to local storage
   */
  private saveTrade(offer: TradeOffer): void {
    if (typeof window === 'undefined') return;
    
    const trades = this.getAllTrades();
    const index = trades.findIndex(t => t.id === offer.id);
    
    if (index >= 0) {
      trades[index] = offer;
    } else {
      trades.push(offer);
    }
    
    localStorage.setItem(this.storageKey, JSON.stringify(trades));
  }

  /**
   * Get trade history
   */
  private getHistory(): TradeHistoryEntry[] {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(this.historyKey);
    return stored ? JSON.parse(stored) : [];
  }

  /**
   * Add trade to history
   */
  private addToHistory(offer: TradeOffer, playerId: string): void {
    if (typeof window === 'undefined') return;
    
    const playerIndex = offer.parties.findIndex(p => p.id === playerId);
    const otherParty = offer.parties[playerIndex === 0 ? 1 : 0];
    
    const historyEntry: TradeHistoryEntry = {
      id: `history-${Date.now()}`,
      offerId: offer.id,
      otherPartyName: otherParty.name,
      cardsGiven: offer.parties[playerIndex].offeredCards,
      cardsReceived: otherParty.offeredCards,
      completedAt: Date.now(),
    };
    
    const history = this.getHistory();
    history.push(historyEntry);
    localStorage.setItem(this.historyKey, JSON.stringify(history));
  }

  /**
   * Notify listeners
   */
  private notify(notification: TradeNotification): void {
    this.listeners.forEach(listener => listener(notification));
  }

  /**
   * Clear all trades (for testing)
   */
  clearAllTrades(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.historyKey);
  }
}

// Singleton instance
export const tradeManager = new TradeManager();

/**
 * Calculate trade fairness score
 */
export function calculateTradeFairness(
  offeredCards: TradeCardItem[],
  wantedCards: TradeCardItem[]
): { score: number; assessment: string } {
  // This is a simplified calculation
  // In a real app, would use actual card prices/values
  const offeredValue = offeredCards.reduce((sum, c) => sum + c.quantity, 0);
  const wantedValue = wantedCards.reduce((sum, c) => sum + c.quantity, 0);
  
  if (offeredValue === 0 || wantedValue === 0) {
    return { score: 0, assessment: 'Incomplete trade' };
  }
  
  const ratio = Math.min(offeredValue, wantedValue) / Math.max(offeredValue, wantedValue);
  
  if (ratio >= 0.9) {
    return { score: ratio, assessment: 'Fair trade' };
  } else if (ratio >= 0.7) {
    return { score: ratio, assessment: 'Slightly imbalanced' };
  } else if (ratio >= 0.5) {
    return { score: ratio, assessment: 'Imbalanced trade' };
  } else {
    return { score: ratio, assessment: 'Highly imbalanced' };
  }
}
