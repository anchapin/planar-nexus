'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useCollection } from '@/hooks/use-collection';
import { tradeManager, type TradeOffer, type TradeCardItem, type TradeHistoryEntry, calculateTradeFairness } from '@/lib/trading';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeftRight, 
  Plus, 
  Trash2, 
  Check, 
  X, 
  MessageSquare,
  History,
  Search,
  Scale,
  Users,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';

export default function TradePage() {
  const { toast } = useToast();
  const { collections, activeCollection } = useCollection();
  
  // State
  const [activeTab, setActiveTab] = useState('active');
  const [trades, setTrades] = useState<TradeOffer[]>([]);
  const [history, setHistory] = useState<TradeHistoryEntry[]>([]);
  const [showNewTradeDialog, setShowNewTradeDialog] = useState(false);
  const [showTradeDetailDialog, setShowTradeDetailDialog] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<TradeOffer | null>(null);
  
  // New trade form
  const [recipientName, setRecipientName] = useState('');
  const [offeredCards, setOfferedCards] = useState<TradeCardItem[]>([]);
  const [wantedCards, setWantedCards] = useState<TradeCardItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [tradeNotes, setTradeNotes] = useState('');
  
  const playerId = 'local-player'; // In real app, would get from auth
  const playerName = 'You';

  // Load trades
  useEffect(() => {
    loadTrades();
    
    // Subscribe to trade updates
    const unsubscribe = tradeManager.subscribe((notification) => {
      toast({
        title: 'Trade Update',
        description: notification.message,
      });
      loadTrades();
    });
    
    return () => unsubscribe();
  }, []);

  const loadTrades = () => {
    const allTrades = tradeManager.getTradesForPlayer(playerId);
    setTrades(allTrades);
    setHistory(tradeManager.getTradeHistory(playerId));
  };

  // Filter cards from collection
  const filteredCollectionCards = activeCollection.cards.filter(c =>
    c.card.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Create new trade
  const handleCreateTrade = () => {
    if (!recipientName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Missing Information',
        description: 'Please enter the recipient name.',
      });
      return;
    }

    if (offeredCards.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Missing Cards',
        description: 'Please add at least one card to offer.',
      });
      return;
    }

    // Create the trade
    const trade = tradeManager.createTradeOffer(
      playerId,
      playerName,
      `player-${Date.now()}`,
      recipientName
    );

    // Add offered cards
    if (offeredCards.length > 0) {
      tradeManager.addCardsToOffer(trade.id, playerId, offeredCards);
    }

    // Add wanted cards
    if (wantedCards.length > 0) {
      tradeManager.addWantedCards(trade.id, playerId, wantedCards);
    }

    // Submit the trade
    tradeManager.submitTradeOffer(trade.id, playerId);

    // Reset form
    setRecipientName('');
    setOfferedCards([]);
    setWantedCards([]);
    setShowNewTradeDialog(false);
    
    toast({
      title: 'Trade Created',
      description: `Trade offer sent to ${recipientName}`,
    });
    
    loadTrades();
  };

  // Add card to offered
  const handleAddOfferedCard = (card: any, quantity: number = 1) => {
    const existing = offeredCards.find(c => c.card.id === card.id);
    if (existing) {
      setOfferedCards(offeredCards.map(c => 
        c.card.id === card.id 
          ? { ...c, quantity: c.quantity + quantity }
          : c
      ));
    } else {
      setOfferedCards([...offeredCards, { card, quantity }]);
    }
  };

  // Add card to wanted
  const handleAddWantedCard = (card: any, quantity: number = 1) => {
    const existing = wantedCards.find(c => c.card.id === card.id);
    if (existing) {
      setWantedCards(wantedCards.map(c => 
        c.card.id === card.id 
          ? { ...c, quantity: c.quantity + quantity }
          : c
      ));
    } else {
      setWantedCards([...wantedCards, { card, quantity }]);
    }
  };

  // Remove card from offered
  const handleRemoveOfferedCard = (cardId: string) => {
    setOfferedCards(offeredCards.filter(c => c.card.id !== cardId));
  };

  // Remove card from wanted
  const handleRemoveWantedCard = (cardId: string) => {
    setWantedCards(wantedCards.filter(c => c.card.id !== cardId));
  };

  // Accept trade
  const handleAcceptTrade = (tradeId: string) => {
    tradeManager.acceptTrade(tradeId, playerId);
    loadTrades();
    toast({
      title: 'Trade Accepted',
      description: 'You have accepted the trade.',
    });
  };

  // Reject trade
  const handleRejectTrade = (tradeId: string) => {
    tradeManager.rejectTrade(tradeId, playerId);
    loadTrades();
    toast({
      title: 'Trade Rejected',
      description: 'You have rejected the trade.',
    });
  };

  // Cancel trade
  const handleCancelTrade = (tradeId: string) => {
    tradeManager.cancelTrade(tradeId, playerId);
    loadTrades();
    toast({
      title: 'Trade Cancelled',
      description: 'The trade has been cancelled.',
    });
  };

  // Add notes to trade
  const handleAddNotes = () => {
    if (!selectedTrade || !tradeNotes.trim()) return;
    tradeManager.addTradeNotes(selectedTrade.id, playerId, tradeNotes);
    setSelectedTrade(tradeManager.getTradeOffer(selectedTrade.id));
    setTradeNotes('');
    toast({
      title: 'Note Added',
      description: 'Your note has been added to the trade.',
    });
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline">Draft</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'countered':
        return <Badge variant="outline">Countered</Badge>;
      case 'accepted':
        return <Badge className="bg-green-500">Accepted</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      case 'cancelled':
        return <Badge variant="outline">Cancelled</Badge>;
      case 'completed':
        return <Badge className="bg-blue-500">Completed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  // Calculate fairness
  const fairness = calculateTradeFairness(offeredCards, wantedCards);

  // Get my party in a trade
  const getMyParty = (trade: TradeOffer) => {
    return trade.parties.find(p => p.id === playerId) || trade.parties[0];
  };

  // Get other party in a trade
  const getOtherParty = (trade: TradeOffer) => {
    return trade.parties.find(p => p.id !== playerId) || trade.parties[1];
  };

  // Pending trades
  const pendingTrades = trades.filter(t => 
    t.status === 'pending' || t.status === 'countered'
  );

  // Active trades (all non-completed)
  const activeTrades = trades.filter(t => 
    t.status !== 'completed' && t.status !== 'cancelled'
  );

  return (
    <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-3xl font-bold flex items-center gap-2">
              <ArrowLeftRight className="w-8 h-8" />
              Trading
            </h1>
            <p className="text-muted-foreground mt-1">
              Trade cards with other players.
            </p>
          </div>
          <Dialog open={showNewTradeDialog} onOpenChange={setShowNewTradeDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Trade
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Trade</DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                {/* Recipient */}
                <div className="space-y-2">
                  <Label htmlFor="recipient">Trade Partner Name</Label>
                  <Input
                    id="recipient"
                    placeholder="Enter partner's name"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                  />
                </div>

                <Separator />

                {/* Offered Cards */}
                <div className="space-y-2">
                  <Label>Cards You're Offering</Label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {offeredCards.map((item) => (
                      <Badge key={item.card.id} variant="secondary" className="flex items-center gap-1">
                        {item.quantity}x {item.card.name}
                        <button onClick={() => handleRemoveOfferedCard(item.card.id)}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  {offeredCards.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Total: {offeredCards.reduce((sum, c) => sum + c.quantity, 0)} cards
                    </div>
                  )}
                </div>

                {/* Want Cards */}
                <div className="space-y-2">
                  <Label>Cards You Want</Label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {wantedCards.map((item) => (
                      <Badge key={item.card.id} variant="outline" className="flex items-center gap-1">
                        {item.quantity}x {item.card.name}
                        <button onClick={() => handleRemoveWantedCard(item.card.id)}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Card Selection */}
                <div className="space-y-2">
                  <Label>Add Cards from Collection</Label>
                  <Input
                    placeholder="Search your collection..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="mb-2"
                  />
                  <ScrollArea className="h-[200px] border rounded-md p-2">
                    <div className="space-y-1">
                      {filteredCollectionCards.slice(0, 20).map((collectionCard) => (
                        <div
                          key={collectionCard.card.id}
                          className="flex items-center justify-between p-2 rounded hover:bg-accent"
                        >
                          <div>
                            <div className="font-medium">{collectionCard.card.name}</div>
                            <div className="text-xs text-muted-foreground">
                              You have: {collectionCard.quantity}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAddOfferedCard(collectionCard.card, 1)}
                            >
                              Offer
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAddWantedCard(collectionCard.card, 1)}
                            >
                              Want
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* Fairness Indicator */}
                {offeredCards.length > 0 && wantedCards.length > 0 && (
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <Scale className="h-5 w-5" />
                    <div>
                      <div className="font-medium">Trade Assessment</div>
                      <div className="text-sm text-muted-foreground">{fairness.assessment}</div>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowNewTradeDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateTrade} disabled={offeredCards.length === 0}>
                  Create Trade
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{pendingTrades.length}</div>
                <div className="text-sm text-muted-foreground">Pending Trades</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <ArrowLeftRight className="h-8 w-8 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{activeTrades.length}</div>
                <div className="text-sm text-muted-foreground">Active Trades</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <History className="h-8 w-8 text-purple-500" />
              <div>
                <div className="text-2xl font-bold">{history.length}</div>
                <div className="text-sm text-muted-foreground">Completed Trades</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="active">Active Trades</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-4">
          {pendingTrades.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ArrowLeftRight className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Pending Trades</h3>
                <p className="text-muted-foreground mb-4">
                  You don't have any active trade offers.
                </p>
                <Button onClick={() => setShowNewTradeDialog(true)}>
                  Create New Trade
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {pendingTrades.map((trade) => {
                const myParty = getMyParty(trade);
                const otherParty = getOtherParty(trade);
                
                return (
                  <Card key={trade.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Users className="h-5 w-5" />
                          <CardTitle>{otherParty.name}</CardTitle>
                        </div>
                        {getStatusBadge(trade.status)}
                      </div>
                      <CardDescription>
                        Created {new Date(trade.createdAt).toLocaleDateString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        {/* What I'm offering */}
                        <div>
                          <h4 className="font-medium mb-2">You Offer</h4>
                          <div className="flex flex-wrap gap-1">
                            {myParty.offeredCards.length > 0 ? (
                              myParty.offeredCards.map((item) => (
                                <Badge key={item.card.id} variant="secondary">
                                  {item.quantity}x {item.card.name}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-sm text-muted-foreground">No cards offered</span>
                            )}
                          </div>
                        </div>
                        
                        {/* What I want */}
                        <div>
                          <h4 className="font-medium mb-2">You Want</h4>
                          <div className="flex flex-wrap gap-1">
                            {myParty.wantedCards.length > 0 ? (
                              myParty.wantedCards.map((item) => (
                                <Badge key={item.card.id} variant="outline">
                                  {item.quantity}x {item.card.name}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-sm text-muted-foreground">No cards specified</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Their response status */}
                      {otherParty.status === 'accepted' && (
                        <div className="flex items-center gap-2 text-green-600 mb-4">
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-sm">They have accepted</span>
                        </div>
                      )}
                      {otherParty.status === 'rejected' && (
                        <div className="flex items-center gap-2 text-red-600 mb-4">
                          <XCircle className="h-4 w-4" />
                          <span className="text-sm">They have rejected</span>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2">
                        {trade.status === 'pending' && myParty.status !== 'accepted' && (
                          <>
                            <Button onClick={() => handleAcceptTrade(trade.id)}>
                              <Check className="h-4 w-4 mr-2" />
                              Accept
                            </Button>
                            <Button variant="outline" onClick={() => handleRejectTrade(trade.id)}>
                              <X className="h-4 w-4 mr-2" />
                              Reject
                            </Button>
                          </>
                        )}
                        {myParty.status === 'accepted' && (
                          <Button variant="outline" disabled>
                            <Check className="h-4 w-4 mr-2" />
                            Accepted - Waiting for partner
                          </Button>
                        )}
                        {trade.status === 'draft' && (
                          <Button variant="destructive" onClick={() => handleCancelTrade(trade.id)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {history.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Trade History</h3>
                <p className="text-muted-foreground">
                  You haven't completed any trades yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <Card key={entry.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">Trade with {entry.otherPartyName}</div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(entry.completedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-center">
                          <div className="font-medium">Gave</div>
                          <div className="text-muted-foreground">
                            {entry.cardsGiven.reduce((sum, c) => sum + c.quantity, 0)} cards
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium">Received</div>
                          <div className="text-muted-foreground">
                            {entry.cardsReceived.reduce((sum, c) => sum + c.quantity, 0)} cards
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Info */}
      <div className="mt-6 text-xs text-muted-foreground text-center">
        Note: This is a local prototype. In production, trading would require a backend server
        for real-time peer-to-peer trading between players.
      </div>
    </div>
  );
}
