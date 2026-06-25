
"use client";

import { useLocalStorage } from "@/hooks/use-local-storage";
import { SavedDeck } from "@/app/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "./ui/label";
import { Skeleton } from "./ui/skeleton";

interface DeckSelectorProps {
  onDeckSelect: (deck: SavedDeck) => void;
  className?: string;
  /**
   * When true (or while saved decks are still hydrating from IndexedDB), a
   * skeleton placeholder is rendered in place of the select trigger to avoid
   * a layout shift and give visual feedback during the deck list load.
   */
  isLoading?: boolean;
}

export function DeckSelector({ onDeckSelect, className, isLoading }: DeckSelectorProps) {
  const [savedDecks, , { loading: decksLoading }] = useLocalStorage<SavedDeck[]>("saved-decks", []);
  const loading = isLoading || decksLoading;

  const handleSelect = (deckId: string) => {
    const selectedDeck = savedDecks.find(d => d.id === deckId);
    if (selectedDeck) {
      onDeckSelect(selectedDeck);
    }
  };

  return (
    <div className={className}>
        <Label htmlFor="deck-selector">Load a Saved Deck</Label>
        {loading ? (
          <Skeleton
            className="h-9 w-full rounded-md border"
            aria-label="Loading saved decks"
            role="status"
            aria-live="polite"
          />
        ) : (
          <Select onValueChange={handleSelect} disabled={savedDecks.length === 0}>
            <SelectTrigger id="deck-selector">
                <SelectValue placeholder="Select a deck..." />
            </SelectTrigger>
            <SelectContent>
                {savedDecks.length > 0 ? (
                    savedDecks.map(deck => (
                        <SelectItem key={deck.id} value={deck.id}>
                           <div className="flex justify-between w-full">
                             <span>{deck.name}</span>
                             <span className="text-muted-foreground capitalize ml-4">{deck.format}</span>
                           </div>
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="no-decks" disabled>No saved decks found</SelectItem>
                )}
            </SelectContent>
          </Select>
        )}
    </div>
  );
}
