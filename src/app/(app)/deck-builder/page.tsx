"use client";

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { ScryfallCard } from "@/app/actions";
import { CardSearch } from "./_components/card-search";
import { DeckList } from "./_components/deck-list";
import { ImportExportControls } from "./_components/import-export-controls";

export type DeckCard = ScryfallCard & {
  count: number;
};

export default function DeckBuilderPage() {
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [deckName, setDeckName] = useState("My Commander Deck");
  const { toast } = useToast();

  const addCardToDeck = (card: ScryfallCard) => {
    setDeck((prevDeck) => {
      const existingCard = prevDeck.find((c) => c.id === card.id);
      const isSingleton = !card.type_line?.includes("Basic Land");
      
      if (isSingleton && existingCard) {
        toast({
          variant: "destructive",
          title: "Singleton Format",
          description: `You can only have one copy of "${card.name}" in a Commander deck.`,
        });
        return prevDeck;
      }
      
      const totalCards = prevDeck.reduce((sum, c) => sum + c.count, 0);
      if (totalCards >= 100) {
        toast({
          variant: "destructive",
          title: "Deck Limit Reached",
          description: "A Commander deck cannot have more than 100 cards.",
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
        <h1 className="font-headline text-3xl font-bold">Deck Builder</h1>
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
