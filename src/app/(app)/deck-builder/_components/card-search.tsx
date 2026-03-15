"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import type { ScryfallCard } from "@/app/actions";
import { initializeCardDatabase, getDatabaseStatus, searchCardsOffline } from "@/lib/card-database";
import { type Format } from "@/lib/game-rules";
import { Input } from "@/components/ui/input";
import { Search, Database, Loader2 } from "lucide-react";
import Image from "next/image";
import { useDebounce } from "use-debounce";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface CardSearchProps {
  onAddCard: (card: ScryfallCard) => void;
}

export function CardSearch({ onAddCard }: CardSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isPending, startTransition] = useTransition();
  const [isInitializing, setIsInitializing] = useState(true);
  const [dbStatus, setDbStatus] = useState<{ loaded: boolean; cardCount: number }>({ loaded: false, cardCount: 0 });
  const { toast } = useToast();

  // Initialize database on mount
  useEffect(() => {
    async function initDB() {
      try {
        await initializeCardDatabase();
        const status = await getDatabaseStatus();
        setDbStatus(status);
      } catch (error) {
        console.error("Failed to initialize card database:", error);
      } finally {
        setIsInitializing(false);
      }
    }

    initDB();
  }, []);

  const handleSearch = useCallback((searchQuery: string) => {
    if (searchQuery.length < 3) {
      setResults([]);
      return;
    }
    startTransition(async () => {
      // Use the current format from the parent component
      // Since we don't have access to format prop, we'll default to commander
      const searchResults = await searchCardsOffline(searchQuery, {
        maxCards: 50,
        format: 'commander' as Format,
        includeImages: true,
      });
      setResults(searchResults as ScryfallCard[]);
    });
  }, []);

  const [debouncedQuery] = useDebounce(query, 300); // Reduced debounce for faster local search

  useEffect(() => {
    handleSearch(debouncedQuery);
  }, [debouncedQuery, handleSearch]);


  return (
    <div className="flex flex-col h-full" role="search" aria-label="Card search">
      {/* Database Status Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Database className="h-4 w-4" />
          <span>
            {isInitializing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Initializing database...
              </span>
            ) : (
              <>
                Local Database
                {dbStatus.loaded && (
                  <Badge variant="secondary" className="ml-2">
                    {dbStatus.cardCount} cards
                  </Badge>
                )}
              </>
            )}
          </span>
        </div>
        {dbStatus.loaded && (
          <span className="text-xs text-muted-foreground">Offline ready</span>
        )}
      </div>

      {/* Search Input */}
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
          disabled={isInitializing}
          data-testid="card-search-input"
        />
      </div>

      {/* Search Results */}
      <ScrollArea className="flex-grow rounded-lg border bg-card p-4">
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          role="list"
          aria-label="Search results"
        >
          {isInitializing && (
            <>
              <div className="col-span-full text-center text-muted-foreground py-10">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p>Initializing offline card database...</p>
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[5/7] rounded-lg" aria-hidden="true" />
              ))}
            </>
          )}

          {!isInitializing && isPending && (
            Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[5/7] rounded-lg" aria-hidden="true" />
            ))
          )}

          {!isInitializing && !isPending && results.length === 0 && (
             <div
              className="col-span-full text-center text-muted-foreground py-10"
              role="status"
              aria-live="polite"
            >
                <p id="search-hint">
                {debouncedQuery.length > 2
                    ? "No cards found in local database."
                    : "Enter a search term to find cards."}
                </p>
                {debouncedQuery.length > 2 && (
                  <div className="mt-4 p-4 bg-muted rounded-lg max-w-md mx-auto">
                    <p className="text-sm mb-2">
                      <strong>Local Database Active</strong>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Search results come from your offline card database. The current database contains essential commander cards. More cards can be added via bulk import in future updates.
                    </p>
                  </div>
                )}
            </div>
          )}

          {!isInitializing && !isPending &&
            results.map((card) => (
              <button
                key={card.id}
                onClick={() => onAddCard(card)}
                className="relative aspect-[5/7] w-full transform transition-transform duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background rounded-lg touch-manipulation"
                title={`Add ${card.name} to deck`}
                aria-label={`Add ${card.name} to deck`}
                data-testid={`card-result-${card.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {card.image_uris?.large || card.image_uris?.normal ? (
                  <Image
                    src={card.image_uris?.normal || ''}
                    alt={card.name}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-lg bg-secondary text-center text-secondary-foreground p-2 text-sm">
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
