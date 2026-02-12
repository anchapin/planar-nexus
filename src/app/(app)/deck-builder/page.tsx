
"use client";

import { useState, useTransition, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { ScryfallCard, DeckCard, importDecklist, SavedDeck } from "@/app/actions";
import { CardSearch } from "./_components/card-search";
import { DeckList } from "./_components/deck-list";
import { ImportExportControls } from "./_components/import-export-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { SavedDecksList } from "./_components/saved-decks-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRules } from "@/lib/game-rules";

export default function DeckBuilderPage() {
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [deckName, setDeckName] = useState("New Deck");
  const [format, setFormat] = useState("commander");
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [isDeckSaved, setIsDeckSaved] = useState(false);
  const [savedDecks, setSavedDecks] = useLocalStorage<SavedDeck[]>('saved-decks', []);

  const { toast } = useToast();
  const [isImporting, startImportTransition] = useTransition();
  
  useEffect(() => {
    // If there is an active deck, check if it's "dirty"
    if (activeDeckId) {
      const activeDeck = savedDecks.find(d => d.id === activeDeckId);
      if (activeDeck) {
        const isNameChanged = activeDeck.name !== deckName;
        const isFormatChanged = activeDeck.format !== format;
        const isCardsChanged = JSON.stringify(activeDeck.cards.map(c => ({ id: c.id, count: c.count })).sort((a,b) => a.id.localeCompare(b.id))) !== JSON.stringify(deck.map(c => ({ id: c.id, count: c.count })).sort((a,b) => a.id.localeCompare(b.id)));
        
        setIsDeckSaved(!isNameChanged && !isFormatChanged && !isCardsChanged);
      }
    } else {
        // New deck is never "saved"
        setIsDeckSaved(false);
    }
  }, [deck, deckName, format, activeDeckId, savedDecks]);


  const handleDeckChange = (updater: (prevDeck: DeckCard[]) => DeckCard[]) => {
    setDeck(updater);
    setIsDeckSaved(false);
  };
  
  const handleDeckNameChange = (name: string) => {
    setDeckName(name);
    setIsDeckSaved(false);
  };

  const handleFormatChange = (newFormat: string) => {
    setFormat(newFormat);
    setIsDeckSaved(false);
  }

  const addCardToDeck = (card: ScryfallCard) => {
    const rules = formatRules[format as keyof typeof formatRules];

    handleDeckChange((prevDeck) => {
      const existingCard = prevDeck.find((c) => c.id === card.id);
      const isBasicLand = card.type_line?.includes("Basic Land");
      
      if (!isBasicLand && existingCard && existingCard.count >= rules.maxCopies) {
        toast({
          variant: "destructive",
          title: "Card Limit Reached",
          description: `You can only have ${rules.maxCopies} cop${rules.maxCopies > 1 ? 'ies' : 'y'} of "${card.name}" in a ${format} deck.`,
        });
        return prevDeck;
      }
      
      const totalCards = prevDeck.reduce((sum, c) => sum + c.count, 0);
      if (rules.maxCards && totalCards >= rules.maxCards) {
        toast({
          variant: "destructive",
          title: "Deck Limit Reached",
          description: `A ${format} deck cannot have more than ${rules.maxCards} cards.`,
        });
        return prevDeck;
      }

      if (existingCard) {
        return prevDeck.map((c) =>
          c.id === card.id ? { ...c, count: c.count + 1 } : c
        );
      } else {
        return [...prevDeck, { ...card, count: 1 }];
      }
    });
  };

  const removeCardFromDeck = (cardId: string) => {
    handleDeckChange((prevDeck) => {
      const existingCard = prevDeck.find((c) => c.id === cardId);
      if (existingCard && existingCard.count > 1) {
        return prevDeck.map((c) =>
          c.id === cardId ? { ...c, count: c.count - 1 } : c
        );
      } else {
        return prevDeck.filter((c) => c.id !== cardId);
      }
    });
  };

  const clearDeck = () => {
    setDeck([]);
    setDeckName("New Deck");
    setActiveDeckId(null);
    toast({
      title: "Deck Cleared",
      description: "Your deck has been emptied.",
    });
  };

  const importDeck = (decklist: string) => {
    if (!decklist.trim()) {
        toast({
            variant: "destructive",
            title: "Empty Decklist",
            description: "Please paste a decklist to import.",
        });
        return;
    }
    setActiveDeckId(null);
    startImportTransition(async () => {
        try {
            const { found, notFound, illegal } = await importDecklist(decklist, format);
            
            if (found.length > 0) {
                setDeck(found);
                toast({
                    title: "Deck Imported Successfully",
                    description: `${found.reduce((acc, card) => acc + card.count, 0)} cards have been added to your deck.`,
                });
            } else {
                 toast({
                    variant: "destructive",
                    title: "Import Failed",
                    description: "No cards from your list could be found.",
                });
            }

            if (notFound.length > 0) {
                toast({
                    variant: "destructive",
                    title: "Some cards not found",
                    description: `The following cards could not be found: ${notFound.join(", ")}. They may be misspelled or not available.`,
                });
            }

            if (illegal.length > 0) {
                toast({
                    variant: "destructive",
                    title: "Illegal Cards Found",
                    description: `The following cards are not legal in ${format}: ${illegal.join(", ")}.`,
                });
            }

        } catch (error) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Import Error",
                description: "An unexpected error occurred while importing the deck.",
            });
        }
    });
  };

  const exportDeck = () => {
    if (deck.length === 0) {
        toast({
            variant: "destructive",
            title: "Empty Deck",
            description: "There are no cards in your deck to export.",
        });
        return;
    }
    const decklist = deck
      .map(card => `${card.count} ${card.name}`)
      .join('\n');
    
    const blob = new Blob([decklist], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deckName.replace(/\s/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
        title: "Deck Exported",
        description: "Your decklist has been downloaded.",
    });
  };

  const saveDeck = () => {
    if (deck.length === 0) {
      toast({ variant: 'destructive', title: 'Cannot Save Empty Deck' });
      return;
    }
    const now = new Date().toISOString();
    if (activeDeckId) {
      // Update existing deck
      const updatedDecks = savedDecks.map(d =>
        d.id === activeDeckId ? { ...d, name: deckName, format, cards: deck, updatedAt: now } : d
      );
      setSavedDecks(updatedDecks);
      toast({ title: 'Deck Updated', description: `"${deckName}" has been updated.` });
    } else {
      // Create new deck
      const newDeck: SavedDeck = {
        id: crypto.randomUUID(),
        name: deckName,
        format,
        cards: deck,
        createdAt: now,
        updatedAt: now,
      };
      setSavedDecks([...savedDecks, newDeck]);
      setActiveDeckId(newDeck.id);
      toast({ title: 'Deck Saved', description: `"${deckName}" has been saved.` });
    }
    setIsDeckSaved(true);
  }

  const loadDeck = (deckToLoad: SavedDeck) => {
    setDeck(deckToLoad.cards);
    setDeckName(deckToLoad.name);
    setFormat(deckToLoad.format);
    setActiveDeckId(deckToLoad.id);
    toast({ title: 'Deck Loaded', description: `Now editing "${deckToLoad.name}".` });
  }

  const deleteDeck = (deckId: string) => {
    setSavedDecks(savedDecks.filter(d => d.id !== deckId));
    if (activeDeckId === deckId) {
      clearDeck();
    }
    toast({ title: 'Deck Deleted' });
  }

  return (
    <div className="flex h-full min-h-svh w-full flex-col p-4 md:p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-6">
          <h1 className="font-headline text-3xl font-bold">Deck Builder</h1>
          <div className="flex items-center gap-2">
            <Label htmlFor="format-select" className="text-muted-foreground">Format</Label>
            <Select value={format} onValueChange={handleFormatChange}>
                <SelectTrigger id="format-select" className="w-40 capitalize">
                    <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="commander">Commander</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="pioneer">Pioneer</SelectItem>
                    <SelectItem value="legacy">Legacy</SelectItem>
                    <SelectItem value="vintage">Vintage</SelectItem>
                    <SelectItem value="pauper">Pauper</SelectItem>
                </SelectContent>
            </Select>
          </div>
        </div>
        <ImportExportControls onImport={importDeck} onExport={exportDeck} onClear={clearDeck} onSave={saveDeck} isDeckSaved={isDeckSaved} isImporting={isImporting} />
      </div>
      <div className="flex-grow grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            <CardSearch onAddCard={addCardToDeck} />
        </div>
        <div className="lg:col-span-1 flex flex-col gap-6">
            <DeckList 
                deck={deck} 
                deckName={deckName}
                onDeckNameChange={handleDeckNameChange}
                onRemoveCard={removeCardFromDeck} 
            />
            <Card>
                <CardHeader>
                    <CardTitle>Saved Decks</CardTitle>
                </CardHeader>
                <CardContent>
                    <SavedDecksList savedDecks={savedDecks} onLoadDeck={loadDeck} onDeleteDeck={deleteDeck} activeDeckId={activeDeckId} />
                </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}
