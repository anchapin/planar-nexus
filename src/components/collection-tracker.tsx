'use client';

import * as React from 'react';
import { useCollection, CollectionCard } from '@/hooks/use-collection';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Minus,
  Search,
  Download,
  Upload,
  Trash2,
  Edit,
  MoreVertical,
  Package,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  BarChart3,
  FolderOpen,
  ArrowUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollectionTrackerProps {
  className?: string;
}

export function CollectionTracker({ className }: CollectionTrackerProps) {
  const {
    collections,
    activeCollection,
    activeCollectionId,
    setActiveCollectionId,
    addCard,
    removeCard,
    createCollection,
    deleteCollection,
    renameCollection,
    importFromCSV,
    exportToCSV,
    getCollectionStats,
    compareDeckWithCollection,
    generateTradeList,
  } = useCollection();

  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortBy, setSortBy] = React.useState<'name' | 'quantity' | 'added'>('name');
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('asc');
  const [showNewCollectionDialog, setShowNewCollectionDialog] = React.useState(false);
  const [newCollectionName, setNewCollectionName] = React.useState('');
  const [importText, setImportText] = React.useState('');
  const [showImportDialog, setShowImportDialog] = React.useState(false);

  const stats = getCollectionStats();

  // Filter and sort cards
  const filteredCards = React.useMemo(() => {
    let cards = [...activeCollection.cards];

    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      cards = cards.filter((c) => c.card.name.toLowerCase().includes(query));
    }

    // Sort
    cards.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.card.name.localeCompare(b.card.name);
          break;
        case 'quantity':
          comparison = a.quantity - b.quantity;
          break;
        case 'added':
          comparison = new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return cards;
  }, [activeCollection.cards, searchQuery, sortBy, sortOrder]);

  const handleCreateCollection = () => {
    if (newCollectionName.trim()) {
      createCollection(newCollectionName.trim());
      setNewCollectionName('');
      setShowNewCollectionDialog(false);
    }
  };

  const handleImport = () => {
    if (importText.trim()) {
      importFromCSV(importText);
      setImportText('');
      setShowImportDialog(false);
    }
  };

  const handleExport = () => {
    const csv = exportToCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeCollection.name.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (field: 'name' | 'quantity' | 'added') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Collection Tracker</h2>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-1" />
                Import
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import Collection</DialogTitle>
                <DialogDescription>
                  Paste your card list in CSV format (quantity,card name) or simple format (quantity card name)
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="4 Lightning Bolt&#10;2 Counterspell&#10;1 Black Lotus"
                  className="w-full h-48 p-2 border rounded-md font-mono text-sm"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleImport}>Import</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-2 p-4 border-b bg-muted/30">
        <div className="text-center">
          <div className="text-2xl font-bold text-primary">{stats.totalCards}</div>
          <div className="text-xs text-muted-foreground">Total Cards</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">{stats.uniqueCards}</div>
          <div className="text-xs text-muted-foreground">Unique</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-500">{stats.playableCards}</div>
          <div className="text-xs text-muted-foreground">Playsets</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-amber-500">{stats.tradeableCards}</div>
          <div className="text-xs text-muted-foreground">Tradeable</div>
        </div>
      </div>

      {/* Collection Selector */}
      <div className="flex items-center gap-2 p-4 border-b">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-[200px] justify-between">
              <FolderOpen className="h-4 w-4 mr-2" />
              {activeCollection.name}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Collections</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {collections.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => setActiveCollectionId(c.id)}
                className={cn(c.id === activeCollectionId && 'bg-primary/10')}
              >
                {c.name} ({c.cards.length} cards)
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowNewCollectionDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Collection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search cards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* Sort Controls */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20">
        <span className="text-xs text-muted-foreground">Sort by:</span>
        <Button
          variant={sortBy === 'name' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => toggleSort('name')}
          className="h-7"
        >
          Name
          {sortBy === 'name' && <ArrowUpDown className="h-3 w-3 ml-1" />}
        </Button>
        <Button
          variant={sortBy === 'quantity' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => toggleSort('quantity')}
          className="h-7"
        >
          Quantity
          {sortBy === 'quantity' && <ArrowUpDown className="h-3 w-3 ml-1" />}
        </Button>
        <Button
          variant={sortBy === 'added' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => toggleSort('added')}
          className="h-7"
        >
          Added
          {sortBy === 'added' && <ArrowUpDown className="h-3 w-3 ml-1" />}
        </Button>
      </div>

      {/* Card List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {filteredCards.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No cards match your search' : 'Your collection is empty. Import cards to get started.'}
            </div>
          ) : (
            filteredCards.map((card) => (
              <CollectionCardItem
                key={card.card.id}
                card={card}
                onAdd={() => addCard(card.card, 1)}
                onRemove={() => removeCard(card.card.id, 1)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* New Collection Dialog */}
      <Dialog open={showNewCollectionDialog} onOpenChange={setShowNewCollectionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Collection</DialogTitle>
            <DialogDescription>Enter a name for your new collection</DialogDescription>
          </DialogHeader>
          <Input
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            placeholder="Collection name"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCollectionDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCollection}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface CollectionCardItemProps {
  card: CollectionCard;
  onAdd: () => void;
  onRemove: () => void;
}

function CollectionCardItem({ card, onAdd, onRemove }: CollectionCardItemProps) {
  const isPlayable = card.quantity >= 4;
  const isTradeable = card.quantity > 4;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-3">
        {/* Card placeholder image */}
        <div className="w-10 h-14 bg-gradient-to-br from-primary/20 to-primary/5 rounded border border-primary/20 flex items-center justify-center">
          <Package className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <div className="font-medium">{card.card.name}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {card.card.set && <span>{card.card.set.toUpperCase()}</span>}
            {isPlayable && (
              <Badge variant="secondary" className="h-5 text-xs">
                <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                Playset
              </Badge>
            )}
            {isTradeable && (
              <Badge variant="outline" className="h-5 text-xs">
                <TrendingUp className="h-3 w-3 mr-1 text-amber-500" />
                Tradeable
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onRemove}>
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-8 text-center font-mono font-bold">{card.quantity}</span>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onAdd}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Deck comparison component
interface DeckComparisonProps {
  deckCards: { name: string; quantity: number }[];
  className?: string;
}

export function DeckComparison({ deckCards, className }: DeckComparisonProps) {
  const { compareDeckWithCollection } = useCollection();
  const comparison = compareDeckWithCollection(deckCards);

  const missingCount = comparison.filter((c) => c.status === 'missing').length;
  const insufficientCount = comparison.filter((c) => c.status === 'insufficient').length;
  const okCount = comparison.filter((c) => c.status === 'ok').length;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Deck vs Collection</CardTitle>
        <CardDescription>Compare your deck list with your collection</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-500">{okCount}</div>
            <div className="text-xs text-muted-foreground">Complete</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-500">{insufficientCount}</div>
            <div className="text-xs text-muted-foreground">Partial</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-500">{missingCount}</div>
            <div className="text-xs text-muted-foreground">Missing</div>
          </div>
        </div>
        <ScrollArea className="h-[200px]">
          <div className="space-y-1">
            {comparison.map((card) => (
              <div
                key={card.name}
                className={cn(
                  'flex items-center justify-between p-2 rounded text-sm',
                  card.status === 'ok' && 'bg-green-500/10',
                  card.status === 'insufficient' && 'bg-amber-500/10',
                  card.status === 'missing' && 'bg-red-500/10'
                )}
              >
                <span>{card.name}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    {card.collectionQuantity}/{card.deckQuantity}
                  </span>
                  {card.status === 'missing' && <AlertCircle className="h-4 w-4 text-red-500" />}
                  {card.status === 'insufficient' && <AlertCircle className="h-4 w-4 text-amber-500" />}
                  {card.status === 'ok' && <CheckCircle className="h-4 w-4 text-green-500" />}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// Trade list component
export function TradeList({ className }: { className?: string }) {
  const { generateTradeList } = useCollection();
  const tradeList = generateTradeList();

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Trade List</CardTitle>
        <CardDescription>Cards you have extras of (more than 4)</CardDescription>
      </CardHeader>
      <CardContent>
        {tradeList.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            No tradeable cards. You need more than 4 copies to trade.
          </div>
        ) : (
          <ScrollArea className="h-[200px]">
            <div className="space-y-1">
              {tradeList.map((card) => (
                <div
                  key={card.name}
                  className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
                >
                  <span>{card.name}</span>
                  <Badge variant="outline">{card.quantity} extra</Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}