"use client";

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { ScryfallCard } from "@/app/actions";
import { CardSearch } from "./_components/card-search";
import { DeckList } from "./_components/deck-list";
import { ImportExportControls } from "./_components/import-export-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export type DeckCard = ScryfallCard & {
  count: number;
};

const formatRules = {
  commander: { maxCopies: 1, minCards: 100, maxCards: 100 },
  standard: { maxCopies: 4, minCards: 60, maxCards: Infinity },
  modern: { maxCopies: 4, minCards: 60, maxCards: Infinity },
  pioneer: { maxCopies: 4, minCards: 60, maxCards: Infinity },
  legacy: { maxCopies: 4, minCards: 60, maxCards: Infinity },
  vintage: { maxCopies: 4, minCards: 60, maxCards: Infinity },
  pauper: { maxCopies: 4, minCards: 60, maxCards: Infinity },
};

export default function DeckBuilderPage() {
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [deckName, setDeckName] = useState("New Deck");
  const [format, setFormat] = useState("commander");
  const { toast } = useToast();

  const addCardToDeck = (card: ScryfallCard) => {
    const rules = formatRules[format as keyof typeof formatRules];

    setDeck((prevDeck) => {
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
    setDeck((prevDeck) => {
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
    toast({
      title: "Deck Cleared",
      description: "Your deck has been emptied.",
    });
  };

  const importDeck = (decklist: string) => {
    // This is a simplified parser. A real implementation would be more robust.
    const cardNames = decklist.split('\n').filter(line => line.trim() !== '');
    // In a real app, we would batch-fetch these cards from scryfall by name.
    // For this prototype, we'll just clear the deck and show a message.
    setDeck([]);
    toast({
      title: "Deck Imported (Prototype)",
      description: `Decklist with ${cardNames.length} cards recognized. Card data would be fetched here.`,
    });
  };

  const exportDeck = () => {
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

  return (
    <div className="flex h-full min-h-svh w-full flex-col p-4 md:p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-6">
          <h1 className="font-headline text-3xl font-bold">Deck Builder</h1>
          <div className="flex items-center gap-2">
            <Label htmlFor="format-select" className="text-muted-foreground">Format</Label>
            <Select value={format} onValueChange={setFormat}>
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
        <ImportExportControls onImport={importDeck} onExport={exportDeck} onClear={clearDeck} />
      </div>
      <div className="flex-grow grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            <CardSearch onAddCard={addCardToDeck} />
        </div>
        <div className="lg:col-span-1">
            <DeckList 
                deck={deck} 
                deckName={deckName}
                onDeckNameChange={setDeckName}
                onRemoveCard={removeCardFromDeck} 
            />
        </div>
      </div>
    </div>
  );
}
