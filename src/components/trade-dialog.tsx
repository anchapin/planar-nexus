/**
 * Trade Dialog Component
 * Issue #292: Add trading system for card exchange
 * 
 * UI component for creating and managing card trades.
 */

'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTrading } from '@/hooks/use-trading';
import type { TradeOffer, TradeCardItem } from '@/lib/trading';
import type { ScryfallCard } from '@/app/actions';

/**
 * Card item display props
 */
interface TradeCardItemProps {
  card: ScryfallCard;
  quantity: number;
  condition?: string;
  notes?: string;
  onRemove?: () => void;
  showRemove?: boolean;
}

/**
 * Trade card item display
 */
function TradeCardItemDisplay({
  card,
  quantity,
  condition,
  notes,
  onRemove,
  showRemove = false,
}: TradeCardItemProps) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg border bg-card">
      {card.image_uris?.small && (
        <img
          src={card.image_uris.small}
          alt={card.name}
          className="w-12 h-16 object-cover rounded"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{card.name}</p>
        <p className="text-xs text-muted-foreground">
          Qty: {quantity}
          {condition && ` • ${condition}`}
        </p>
        {notes && (
          <p className="text-xs text-muted-foreground truncate">{notes}</p>
        )}
      </div>
      {showRemove && onRemove && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="text-destructive hover:text-destructive"
        >
          ×
        </Button>
      )}
    </div>
  );
}

/**
 * Trade dialog props
 */
export interface TradeDialogProps {
  /** Whether dialog is open */
  open: boolean;
  /** Close handler */
  onOpenChange: (open: boolean) => void;
  /** Trading hook */
  trading: ReturnType<typeof useTrading>;
  /** Current player's collection */
  myCollection?: ScryfallCard[];
  /** Other player's collection (for viewing wants) */
  otherCollection?: ScryfallCard[];
  /** Player ID to trade with */
  recipientId?: string;
  /** Player name to trade with */
  recipientName?: string;
}

/**
 * Trade Dialog Component
 */
export function TradeDialog({
  open,
  onOpenChange,
  trading,
  myCollection = [],
  otherCollection: _otherCollection = [],
  recipientId,
  recipientName,
}: TradeDialogProps) {
  const { currentTrade, createTrade, addCardsToOffer, submitTrade, acceptTrade, rejectTrade, cancelTrade, counterOffer, getTradeFairness, addNotes } = trading;

  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [notesInput, setNotesInput] = useState('');
  const [recipientIdInput, setRecipientIdInput] = useState(recipientId || '');
  const [recipientNameInput, setRecipientNameInput] = useState(recipientName || '');

  // Calculate trade fairness
  const fairness = useMemo(() => {
    if (!currentTrade) return null;
    return getTradeFairness(currentTrade.id);
  }, [currentTrade, getTradeFairness]);

  // Get my party index
  const myIndex = useMemo(() => {
    if (!currentTrade) return -1;
    return currentTrade.parties.findIndex((p) => p.id === trading.currentTrade?.parties[0].id);
  }, [currentTrade]);

  // Get other party index
  const otherIndex = myIndex === 0 ? 1 : 0;

  // Handle create trade
  const handleCreateTrade = () => {
    if (recipientIdInput && recipientNameInput) {
      createTrade(recipientIdInput, recipientNameInput);
    }
  };

  // Handle add selected cards to offer
  const handleAddSelectedCards = () => {
    const cardsToAdd: TradeCardItem[] = myCollection
      .filter((card) => selectedCards.has(card.id))
      .map((card) => ({
        card,
        quantity: 1,
        condition: 'near-mint' as const,
      }));

    if (cardsToAdd.length > 0) {
      addCardsToOffer(cardsToAdd);
      setSelectedCards(new Set());
    }
  };

  // Handle submit trade
  const handleSubmit = () => {
    submitTrade();
    onOpenChange(false);
  };

  // Handle accept trade
  const handleAccept = () => {
    if (currentTrade) {
      acceptTrade(currentTrade.id);
      onOpenChange(false);
    }
  };

  // Handle reject trade
  const handleReject = () => {
    if (currentTrade) {
      rejectTrade(currentTrade.id);
      onOpenChange(false);
    }
  };

  // Handle cancel trade
  const handleCancel = () => {
    if (currentTrade) {
      cancelTrade(currentTrade.id);
      onOpenChange(false);
    }
  };

  // Handle counter offer
  const handleCounterOffer = () => {
    if (currentTrade) {
      counterOffer(currentTrade.id);
    }
  };

  // Handle add notes
  const handleAddNotes = () => {
    if (notesInput.trim()) {
      addNotes(notesInput.trim());
      setNotesInput('');
    }
  };

  // Get status badge color
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return 'secondary';
      case 'pending':
        return 'default';
      case 'countered':
        return 'warning';
      case 'accepted':
        return 'success';
      case 'rejected':
        return 'destructive';
      case 'completed':
        return 'success';
      case 'cancelled':
        return 'secondary';
      default:
        return 'default';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {currentTrade ? 'Trade Offer' : 'New Trade'}
          </DialogTitle>
          <DialogDescription>
            {currentTrade
              ? `Trading with ${currentTrade.parties[otherIndex]?.name || 'Unknown'}`
              : 'Create a new trade offer with another player'}
          </DialogDescription>
        </DialogHeader>

        {!currentTrade ? (
          // Create new trade form
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="recipient-id">Recipient ID</Label>
                <Input
                  id="recipient-id"
                  value={recipientIdInput}
                  onChange={(e) => setRecipientIdInput(e.target.value)}
                  placeholder="Enter player ID"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="recipient-name">Recipient Name</Label>
                <Input
                  id="recipient-name"
                  value={recipientNameInput}
                  onChange={(e) => setRecipientNameInput(e.target.value)}
                  placeholder="Enter player name"
                />
              </div>
            </div>
            <Button
              onClick={handleCreateTrade}
              disabled={!recipientIdInput || !recipientNameInput}
            >
              Create Trade
            </Button>
          </div>
        ) : (
          // Trade view/edit
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Status bar */}
            <div className="flex items-center justify-between mb-4">
              <Badge variant={getStatusBadge(currentTrade.status) as "secondary" | "default" | "destructive" | "outline" | null}>
                {currentTrade.status.charAt(0).toUpperCase() + currentTrade.status.slice(1)}
              </Badge>
              {fairness && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Fairness: </span>
                  <span
                    className={
                      fairness.score >= 0.9
                        ? 'text-green-500'
                        : fairness.score >= 0.7
                        ? 'text-yellow-500'
                        : 'text-red-500'
                    }
                  >
                    {Math.round(fairness.score * 100)}% - {fairness.assessment}
                  </span>
                </div>
              )}
            </div>

            {/* Trade content */}
            <Tabs defaultValue="cards" className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="cards">Cards</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="cards" className="flex-1 overflow-hidden">
                <div className="grid grid-cols-2 gap-4 h-full">
                  {/* My offer */}
                  <div className="space-y-2">
                    <h4 className="font-medium">Your Offer</h4>
                    <ScrollArea className="h-[300px] rounded border p-2">
                      {currentTrade.parties[myIndex]?.offeredCards.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No cards offered yet
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {currentTrade.parties[myIndex]?.offeredCards.map((item) => (
                            <TradeCardItemDisplay
                              key={item.card.id}
                              card={item.card}
                              quantity={item.quantity}
                              condition={item.condition}
                              notes={item.notes}
                              showRemove={currentTrade.status === 'draft'}
                              onRemove={() => trading.removeCardFromOffer(item.card.id)}
                            />
                          ))}
                        </div>
                      )}
                    </ScrollArea>

                    {/* Add cards from collection */}
                    {currentTrade.status === 'draft' && myCollection.length > 0 && (
                      <div className="space-y-2">
                        <Label>Add from Collection</Label>
                        <ScrollArea className="h-[100px] rounded border p-2">
                          <div className="grid grid-cols-2 gap-1">
                            {myCollection.slice(0, 10).map((card) => (
                              <label
                                key={card.id}
                                className="flex items-center gap-2 text-xs cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedCards.has(card.id)}
                                  onChange={(e) => {
                                    const newSet = new Set(selectedCards);
                                    if (e.target.checked) {
                                      newSet.add(card.id);
                                    } else {
                                      newSet.delete(card.id);
                                    }
                                    setSelectedCards(newSet);
                                  }}
                                />
                                <span className="truncate">{card.name}</span>
                              </label>
                            ))}
                          </div>
                        </ScrollArea>
                        <Button
                          size="sm"
                          onClick={handleAddSelectedCards}
                          disabled={selectedCards.size === 0}
                        >
                          Add Selected ({selectedCards.size})
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Their offer */}
                  <div className="space-y-2">
                    <h4 className="font-medium">
                      {currentTrade.parties[otherIndex]?.name || 'Other Player'}'s Offer
                    </h4>
                    <ScrollArea className="h-[300px] rounded border p-2">
                      {currentTrade.parties[otherIndex]?.offeredCards.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No cards offered yet
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {currentTrade.parties[otherIndex]?.offeredCards.map((item) => (
                            <TradeCardItemDisplay
                              key={item.card.id}
                              card={item.card}
                              quantity={item.quantity}
                              condition={item.condition}
                              notes={item.notes}
                            />
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="notes" className="flex-1 overflow-hidden">
                <div className="space-y-4">
                  {/* Existing notes */}
                  <ScrollArea className="h-[200px] rounded border p-2">
                    {currentTrade.notes ? (
                      <div className="text-sm whitespace-pre-wrap">{currentTrade.notes}</div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No notes yet
                      </p>
                    )}
                  </ScrollArea>

                  {/* Add notes */}
                  <div className="space-y-2">
                    <Label>Add Note</Label>
                    <div className="flex gap-2">
                      <Input
                        value={notesInput}
                        onChange={(e) => setNotesInput(e.target.value)}
                        placeholder="Type a message..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAddNotes();
                          }
                        }}
                      />
                      <Button onClick={handleAddNotes} disabled={!notesInput.trim()}>
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <Separator className="my-4" />

            {/* Action buttons */}
            <DialogFooter className="flex-wrap gap-2">
              {currentTrade.status === 'draft' && (
                <>
                  <Button variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit}>
                    Send Trade Offer
                  </Button>
                </>
              )}

              {currentTrade.status === 'pending' && (
                <>
                  <Button variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                  {currentTrade.parties[myIndex]?.status === 'pending' && (
                    <>
                      <Button variant="destructive" onClick={handleReject}>
                        Reject
                      </Button>
                      <Button variant="outline" onClick={handleCounterOffer}>
                        Counter Offer
                      </Button>
                      <Button onClick={handleAccept}>
                        Accept
                      </Button>
                    </>
                  )}
                </>
              )}

              {currentTrade.status === 'countered' && (
                <>
                  <Button variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleReject}>
                    Reject
                  </Button>
                  <Button onClick={handleAccept}>
                    Accept Counter
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Trade list item component
 */
export interface TradeListItemProps {
  trade: TradeOffer;
  playerId: string;
  onSelect: () => void;
}

export function TradeListItem({ trade, playerId, onSelect }: TradeListItemProps) {
  const myIndex = trade.parties.findIndex((p) => p.id === playerId);
  const otherParty = trade.parties[myIndex === 0 ? 1 : 0];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-500';
      case 'countered':
        return 'bg-orange-500';
      case 'accepted':
        return 'bg-green-500';
      case 'rejected':
        return 'bg-red-500';
      case 'completed':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-accent"
      onClick={onSelect}
    >
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${getStatusColor(trade.status)}`} />
        <div>
          <p className="font-medium">{otherParty?.name || 'Unknown'}</p>
          <p className="text-sm text-muted-foreground">
            {trade.parties[myIndex]?.offeredCards.length || 0} cards offered •{' '}
            {otherParty?.offeredCards.length || 0} cards requested
          </p>
        </div>
      </div>
      <div className="text-right">
        <Badge variant="outline">{trade.status}</Badge>
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(trade.updatedAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

export default TradeDialog;