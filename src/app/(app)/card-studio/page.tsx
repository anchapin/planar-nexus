'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Copy, 
  Download, 
  Upload, 
  Palette,
  FolderOpen,
  Save,
  ArrowLeft,
  MoreVertical,
  Grid,
  List
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CustomCardEditor } from '@/components/custom-card-editor';
import { CustomCardPreview } from '@/components/custom-card-preview';
import {
  type CustomCardDefinition,
  generateCustomCardId,
  validateCustomCard,
  DEFAULT_CUSTOM_CARD,
} from '@/lib/custom-card';
import {
  getCustomCards,
  saveCustomCard,
  deleteCustomCard,
  getCustomCardById,
  exportAllCustomCards,
  importCustomCards,
  clearAllCustomCards,
} from '@/lib/custom-card-storage';

/**
 * Custom Card Creation Studio Page
 * 
 * WYSIWYG editor for creating custom Magic: The Gathering cards
 * Issue #593: Custom Card Creation Studio - WYSIWYG editor
 */

function CardStudioContent() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Get card ID from URL if editing existing card
  const editCardId = searchParams.get('edit');
  
  // State
  const [cards, setCards] = useState<CustomCardDefinition[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(editCardId);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
  // Load cards on mount
  useEffect(() => {
    loadCards();
  }, []);
  
  // Load cards from storage
  const loadCards = useCallback(() => {
    setIsLoading(true);
    try {
      const loadedCards = getCustomCards();
      setCards(loadedCards);
      
      // Select first card if none selected and cards exist
      if (!selectedCardId && loadedCards.length > 0) {
        setSelectedCardId(loadedCards[0].id);
      }
      
      // If editing existing card from URL
      if (editCardId) {
        const card = loadedCards.find(c => c.id === editCardId);
        if (card) {
          setSelectedCardId(editCardId);
        }
      }
    } catch (error) {
      console.error('Error loading cards:', error);
      toast({
        variant: 'destructive',
        title: 'Error Loading Cards',
        description: 'Failed to load custom cards from storage.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [editCardId, selectedCardId, toast]);
  
  // Get selected card
  const selectedCard = selectedCardId ? cards.find(c => c.id === selectedCardId) : null;
  
  // Handle save card
  const handleSaveCard = useCallback((card: CustomCardDefinition) => {
    try {
      saveCustomCard(card);
      
      // Update local state
      setCards(prev => {
        const existingIndex = prev.findIndex(c => c.id === card.id);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = card;
          return updated;
        }
        return [...prev, card];
      });
      
      setSelectedCardId(card.id);
      
      toast({
        title: 'Card Saved',
        description: `"${card.name}" has been saved.`,
      });
    } catch (error) {
      console.error('Error saving card:', error);
      toast({
        variant: 'destructive',
        title: 'Error Saving Card',
        description: 'Failed to save the card.',
      });
    }
  }, [toast]);
  
  // Handle delete card
  const handleDeleteCard = useCallback((cardId: string) => {
    try {
      deleteCustomCard(cardId);
      
      // Update local state
      setCards(prev => prev.filter(c => c.id !== cardId));
      
      // Select another card if deleting selected
      if (selectedCardId === cardId) {
        const remainingCards = cards.filter(c => c.id !== cardId);
        setSelectedCardId(remainingCards.length > 0 ? remainingCards[0].id : null);
      }
      
      toast({
        title: 'Card Deleted',
        description: 'The card has been deleted.',
      });
    } catch (error) {
      console.error('Error deleting card:', error);
      toast({
        variant: 'destructive',
        title: 'Error Deleting Card',
        description: 'Failed to delete the card.',
      });
    }
  }, [selectedCardId, cards, toast]);
  
  // Handle export all
  const handleExportAll = useCallback(() => {
    try {
      const json = exportAllCustomCards();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'custom-cards.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: 'Cards Exported',
        description: `${cards.length} cards have been exported.`,
      });
    } catch (error) {
      console.error('Error exporting cards:', error);
      toast({
        variant: 'destructive',
        title: 'Error Exporting Cards',
        description: 'Failed to export cards.',
      });
    }
  }, [cards.length, toast]);
  
  // Handle import
  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const result = importCustomCards(text);
        
        if (result.success) {
          loadCards();
          toast({
            title: 'Cards Imported',
            description: `Successfully imported ${result.count} cards.`,
          });
        } else {
          toast({
            variant: 'destructive',
            title: 'Import Failed',
            description: result.errors.join(', '),
          });
        }
      } catch (error) {
        console.error('Error importing cards:', error);
        toast({
          variant: 'destructive',
          title: 'Error Importing Cards',
          description: 'Failed to import cards.',
        });
      }
    };
    input.click();
  }, [loadCards, toast]);
  
  // Handle new card
  const handleCreateNew = useCallback(() => {
    const newCard: CustomCardDefinition = {
      ...DEFAULT_CUSTOM_CARD,
      id: generateCustomCardId(),
      name: 'New Card',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    setSelectedCardId(newCard.id);
    setCards(prev => [...prev, newCard]);
    
    // Don't save yet - user needs to edit first
    router.push('/card-studio');
  }, [router]);
  
  // Handle card click from list
  const handleCardClick = useCallback((cardId: string) => {
    setSelectedCardId(cardId);
    router.push(`/card-studio?edit=${cardId}`, { scroll: false });
  }, [router]);

  return (
    <div className="flex h-full min-h-svh w-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 p-4 md:p-6 border-b">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => router.push('/dashboard')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-headline text-2xl font-bold">Card Creation Studio</h1>
            <p className="text-sm text-muted-foreground">
              Create custom Magic: The Gathering cards with visual editing
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportAll} disabled={cards.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export All
          </Button>
          <Button size="sm" onClick={handleCreateNew}>
            <Plus className="w-4 h-4 mr-2" />
            New Card
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Card List */}
        <div className="w-72 border-r bg-card flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">My Cards</h2>
              <Badge variant="secondary">{cards.length}</Badge>
            </div>
            <div className="flex gap-1">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode('grid')}
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode('list')}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground">
                Loading cards...
              </div>
            ) : cards.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-muted-foreground mb-4">No custom cards yet</p>
                <Button onClick={handleCreateNew}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Card
                </Button>
              </div>
            ) : (
              <div className={cn(
                'p-2',
                viewMode === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-1'
              )}>
                {cards.map(card => (
                  <Card
                    key={card.id}
                    className={cn(
                      'cursor-pointer transition-all hover:shadow-md',
                      selectedCardId === card.id && 'ring-2 ring-primary'
                    )}
                    onClick={() => handleCardClick(card.id)}
                  >
                    {viewMode === 'grid' ? (
                      <CardContent className="p-2">
                        <div className="aspect-[3/4] relative rounded overflow-hidden bg-muted">
                          <div className="scale-[0.25] absolute -top-4 -left-4 origin-top-left w-[312px]">
                            <CardPreview card={card} />
                          </div>
                        </div>
                        <p className="text-xs text-center truncate mt-1">{card.name}</p>
                      </CardContent>
                    ) : (
                      <CardContent className="p-2 flex items-center gap-2">
                        <div className="w-10 h-14 shrink-0 rounded overflow-hidden bg-muted">
                          <div className="scale-[0.08] origin-top-left w-[312px]">
                            <CardPreview card={card} />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{card.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{card.typeLine}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCard(card.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Main Content - Editor */}
        <div className="flex-1 overflow-auto bg-muted/30">
          {selectedCard ? (
            <CustomCardEditor
              key={selectedCard.id}
              initialCard={selectedCard}
              onSave={handleSaveCard}
              onDelete={handleDeleteCard}
              onCreateNew={handleCreateNew}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Card className="max-w-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="w-5 h-5" />
                    Welcome to Card Studio
                  </CardTitle>
                  <CardDescription>
                    Create custom Magic: The Gathering cards with a visual WYSIWYG editor
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Start by creating a new card or selecting one from your collection.
                    Your cards are saved locally and can be exported for sharing.
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={handleCreateNew}>
                      <Plus className="w-4 h-4 mr-2" />
                      Create New Card
                    </Button>
                    {cards.length > 0 && (
                      <Button variant="outline" onClick={() => handleCardClick(cards[0].id)}>
                        <FolderOpen className="w-4 h-4 mr-2" />
                        Open First Card
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Simple card preview for sidebar
function CardPreview({ card }: { card: CustomCardDefinition }) {
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  if (!isClient) {
    return <div className="w-[312px] h-[445px] bg-muted animate-pulse rounded-lg" />;
  }
  
  return <CustomCardPreview card={card} scale={1} />;
}

// Default export with Suspense wrapper for useSearchParams
export default function CardStudioPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <div className="animate-pulse text-muted-foreground">Loading Card Studio...</div>
      </div>
    }>
      <CardStudioContent />
    </Suspense>
  );
}
