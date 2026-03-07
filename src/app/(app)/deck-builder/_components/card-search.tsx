"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { searchScryfall, ScryfallCard } from "@/app/actions";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import Image from "next/image";
import { useDebounce } from "use-debounce";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CardSearchProps {
  onAddCard: (card: ScryfallCard) => void;
}

export function CardSearch({ onAddCard }: CardSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isPending, startTransition] = useTransition();

  const handleSearch = useCallback((searchQuery: string) => {
    if (searchQuery.length < 3) {
      setResults([]);
      return;
    }
    startTransition(async () => {
      const searchResults = await searchScryfall(searchQuery);
      setResults(searchResults);
    });
  }, []);

  const [debouncedQuery] = useDebounce(query, 500);

  useEffect(() => {
    handleSearch(debouncedQuery);
  }, [debouncedQuery, handleSearch]);


  return (
    <div className="flex flex-col h-full" role="search" aria-label="Card search">
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          placeholder="Search for cards (e.g., 'Sol Ring')"
          className="pl-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search cards by name"
          aria-describedby="search-hint"
        />
      </div>
      <ScrollArea className="flex-grow rounded-lg border bg-card p-4">
        <div 
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          role="list"
          aria-label="Search results"
        >
          {isPending &&
            Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[5/7] rounded-lg" aria-hidden="true" />
            ))}
          {!isPending && results.length === 0 && (
             <div 
              className="col-span-full text-center text-muted-foreground py-10"
              role="status"
              aria-live="polite"
            >
                <p id="search-hint">
                {debouncedQuery.length > 2
                    ? "No cards found."
                    : "Enter a search term to find cards."}
                </p>
            </div>
          )}
          {!isPending &&
            results.map((card) => (
              <button
                key={card.id}
                onClick={() => onAddCard(card)}
                className="relative aspect-[5/7] w-full transform transition-transform duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background rounded-lg touch-manipulation"
                title={`Add ${card.name} to deck`}
                aria-label={`Add ${card.name} to deck`}
              >
                {card.image_uris?.large || image_uris?.normal ? (
                  <Image
                    src={card.image_uris.normal}
                    alt={card.name}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-lg bg-secondary text-center text-secondary-foreground p-2">
                    {card.name}
                  </div>
                )}
              </button>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
