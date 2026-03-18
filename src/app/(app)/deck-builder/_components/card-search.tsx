"use client";

import { useState, useTransition, useCallback, useEffect, forwardRef, useImperativeHandle, useRef } from "react";
import type { ScryfallCard } from "@/app/actions";
import { initializeCardDatabase, getDatabaseStatus, searchCardsOffline, getAllCards } from "@/lib/card-database";
import type { MinimalCard } from "@/lib/card-database";
import { type Format } from "@/lib/game-rules";
import { useCardFilters } from "@/hooks/use-card-filters";
import { useSearchPresets } from "@/hooks/use-search-presets";
import { QUICK_PRESETS, getPresetsByCategory, type QuickPreset } from "@/lib/search/quick-presets";
import { Input } from "@/components/ui/input";
import { Search, Database, Loader2, X, Save, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDebounce } from "use-debounce";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useSynergy } from "./synergy-context";
import Image from "next/image";

interface CardSearchHandle {
  focus: () => void;
}

interface CardSearchProps {
  onAddCard: (card: ScryfallCard) => void;
}

/**
 * Convert ScryfallCard to MinimalCard for filtering
 */
function toMinimalCard(card: ScryfallCard): MinimalCard {
  return {
    id: card.id,
    name: card.name,
    set: card.set,
    collector_number: card.collector_number,
    cmc: card.cmc,
    type_line: card.type_line || '',
    oracle_text: card.oracle_text,
    colors: card.colors || [],
    color_identity: card.color_identity || [],
    rarity: card.rarity,
    legalities: card.legalities || {},
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    power: card.power,
    toughness: card.toughness,
    keywords: card.keywords || [],
  };
}

export const CardSearch = forwardRef<CardSearchHandle, CardSearchProps>(function CardSearch({ onAddCard }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isPending, startTransition] = useTransition();
  const [isInitializing, setIsInitializing] = useState(true);
  const [dbStatus, setDbStatus] = useState<{ loaded: boolean; cardCount: number }>({ loaded: false, cardCount: 0 });
  const { toast } = useToast();

  // Initialize filter hook for advanced filtering
  const { filters, setFilter, sortConfig, setSort, hasActiveFilters, search: filterSearch, resetFilters } = useCardFilters();
  
  // Quick presets state
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const presetsByCategory = getPresetsByCategory();
  
  // Saved search presets
  const { presets: savedPresets, isLoading: isLoadingPresets, savePreset, deletePreset } = useSearchPresets();
  const [selectedSavedPresetId, setSelectedSavedPresetId] = useState<string | null>(null);
  const [isSavePresetDialogOpen, setIsSavePresetDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  
  // Store all cards for filtering
  const [allCards, setAllCards] = useState<MinimalCard[]>([]);

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }), []);

  // Handle applying a quick preset
  const handleQuickPreset = useCallback((presetId: string) => {
    if (presetId === 'clear') {
      // Clear all filters
      resetFilters();
      setSelectedPresetId(null);
      return;
    }

    const preset = QUICK_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    // Clear existing filters first
    resetFilters();

    // Apply each filter from the preset
    Object.entries(preset.filters).forEach(([key, value]) => {
      if (value !== undefined) {
        setFilter(key as keyof typeof filters, value);
      }
    });

    setSelectedPresetId(presetId);
  }, [resetFilters, setFilter]);

  // Update selected preset when filters change externally
  useEffect(() => {
    if (!hasActiveFilters) {
      setSelectedPresetId(null);
      return;
    }

    // Check if current filters match any preset
    const match = QUICK_PRESETS.find(preset => {
      const presetFilters = preset.filters;
      return Object.entries(presetFilters).every(([key, value]) => {
        if (value === undefined) return true;
        const currentValue = filters[key as keyof typeof filters];
        return JSON.stringify(currentValue) === JSON.stringify(value);
      });
    });

    setSelectedPresetId(match?.id || null);
  }, [filters, hasActiveFilters]);

  // Handle saving a preset
  const handleSavePreset = useCallback(async () => {
    if (!newPresetName.trim()) {
      toast({
        title: "Preset name required",
        description: "Please enter a name for your preset.",
        variant: "destructive",
      });
      return;
    }

    try {
      await savePreset(newPresetName.trim(), filters, sortConfig.option, sortConfig.direction);
      setNewPresetName("");
      setIsSavePresetDialogOpen(false);
      toast({
        title: "Preset saved",
        description: `"${newPresetName.trim()}" has been saved.`,
      });
    } catch (error) {
      toast({
        title: "Failed to save preset",
        description: "There was an error saving your preset.",
        variant: "destructive",
      });
    }
  }, [newPresetName, filters, sortConfig, savePreset, toast]);

  // Handle loading a saved preset
  const handleLoadSavedPreset = useCallback((presetId: string) => {
    const preset = savedPresets.find(p => p.id === presetId);
    if (!preset) return;

    // Clear existing filters first
    resetFilters();

    // Apply filters from the saved preset
    if (preset.filters) {
      Object.entries(preset.filters).forEach(([key, value]) => {
        if (value !== undefined) {
          setFilter(key as keyof typeof filters, value);
        }
      });
    }

    // Apply sort if present
    if (preset.sortOption || preset.sortDirection) {
      setSort({
        option: preset.sortOption || 'name',
        direction: preset.sortDirection || 'asc',
      });
    }

    setSelectedSavedPresetId(presetId);
    setSelectedPresetId(null); // Clear quick preset selection
  }, [savedPresets, resetFilters, setFilter, setSort]);

  // Handle deleting a saved preset
  const handleDeleteSavedPreset = useCallback(async (presetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      await deletePreset(presetId);
      if (selectedSavedPresetId === presetId) {
        setSelectedSavedPresetId(null);
      }
      toast({
        title: "Preset deleted",
        description: "The preset has been removed.",
      });
    } catch (error) {
      toast({
        title: "Failed to delete preset",
        description: "There was an error deleting the preset.",
        variant: "destructive",
      });
    }
  }, [deletePreset, selectedSavedPresetId, toast]);

  // Initialize database on mount
  useEffect(() => {
    async function initDB() {
      try {
        await initializeCardDatabase();
        const status = await getDatabaseStatus();
        setDbStatus(status);
        
        // Load all cards for filtering
        const cards = await getAllCards();
        setAllCards(cards);
      } catch (error) {
        console.error("Failed to initialize card database:", error);
      } finally {
        setIsInitializing(false);
      }
    }

    initDB();
  }, []);

  // Debounce the query for search
  const [debouncedQuery] = useDebounce(query, 300);

  // Apply search and filtering when query or filters change
  useEffect(() => {
    if (!dbStatus.loaded) return;
    
    startTransition(async () => {
      let searchResults: ScryfallCard[];
      
      if (debouncedQuery.length >= 2) {
        // Perform name-based search first
        searchResults = await searchCardsOffline(debouncedQuery, {
          maxCards: 50,
          format: 'commander' as Format,
          includeImages: true,
        }) as ScryfallCard[];
      } else {
        // No query - get a subset of cards or empty
        searchResults = [];
      }
      
      // Apply additional filters from the hook if active
      if (hasActiveFilters && searchResults.length > 0) {
        // Convert to MinimalCard for filtering
        const minimalCards = searchResults.map(toMinimalCard);
        
        // Apply filters and sorting using the hook
        const filtered = filterSearch(debouncedQuery, minimalCards);
        
        // Get IDs of filtered cards
        const filteredIds = new Set(filtered.map(c => c.id));
        
        // Keep only filtered results
        searchResults = searchResults.filter(card => filteredIds.has(card.id));
      }
      
      setResults(searchResults);
    });
  }, [debouncedQuery, filters, sortConfig, dbStatus.loaded, hasActiveFilters, filterSearch]);

  const { synergyData } = useSynergy();

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

      {/* Search Input and Quick Filters */}
      <div className="space-y-3 mb-4">
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search for cards (e.g., 'Sol Ring') + Ctrl+F"
            className="pl-10"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search cards by name"
            aria-describedby="search-hint"
            disabled={isInitializing}
            data-testid="card-search-input"
          />
        </div>

        {/* Quick Presets Dropdown */}
        <div className="flex items-center gap-2">
          <Select value={selectedPresetId || ''} onValueChange={handleQuickPreset}>
            <SelectTrigger className="w-full" aria-label="Quick filters">
              <SelectValue placeholder="Quick Filters" />
            </SelectTrigger>
            <SelectContent>
              {/* CMC Presets */}
              <SelectGroup>
                <SelectLabel>Converted Mana Cost</SelectLabel>
                {presetsByCategory.cmc.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectGroup>

              {/* Type Presets */}
              <SelectGroup>
                <SelectLabel>Card Type</SelectLabel>
                {presetsByCategory.type.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectGroup>

              {/* Rarity Presets */}
              <SelectGroup>
                <SelectLabel>Rarity</SelectLabel>
                {presetsByCategory.rarity.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectGroup>

              {/* Color Presets */}
              <SelectGroup>
                <SelectLabel>Color</SelectLabel>
                {presetsByCategory.color.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectGroup>

              {/* Clear Filters Option */}
              <SelectItem value="clear" className="text-muted-foreground">
                Clear Filters
              </SelectItem>
            </SelectContent>
          </Select>

          {/* Active Filters Badge */}
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetFilters();
                setSelectedPresetId(null);
              }}
              className="shrink-0"
              aria-label="Clear all filters"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {/* Saved Presets Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Save Preset Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSavePresetDialogOpen(true)}
            disabled={isInitializing || !hasActiveFilters}
            className="flex items-center gap-1"
          >
            <Save className="h-4 w-4" />
            Save
          </Button>

          {/* Load Saved Preset Dropdown */}
          <Select
            value={selectedSavedPresetId || ""}
            onValueChange={(value) => {
              if (value) {
                handleLoadSavedPreset(value);
              }
            }}
            disabled={isInitializing || isLoadingPresets || savedPresets.length === 0}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Load saved preset" />
            </SelectTrigger>
            <SelectContent>
              {savedPresets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{preset.name}</span>
                    <button
                      onClick={(e) => handleDeleteSavedPreset(preset.id, e)}
                      className="p-1 hover:bg-destructive hover:text-destructive-foreground rounded"
                      aria-label={`Delete ${preset.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {savedPresets.length === 0 && !isLoadingPresets && (
            <span className="text-xs text-muted-foreground">No saved presets</span>
          )}
        </div>
      </div>

      {/* Save Preset Dialog */}
      <Dialog open={isSavePresetDialogOpen} onOpenChange={setIsSavePresetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Filter Preset</DialogTitle>
            <DialogDescription>
              Save your current filter configuration for quick access later.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Preset name (e.g., 'Blue Control')"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSavePreset();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSavePresetDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePreset}>
              Save Preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            results.map((card) => {
              const synergy = synergyData.get(card.id);
              const hasHighSynergy = synergy && synergy.score >= 60;

              return (
                <button
                  key={card.id}
                  onClick={() => onAddCard(card)}
                  className="relative aspect-[5/7] w-full transform transition-transform duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background rounded-lg touch-manipulation group"
                  title={`Add ${card.name} to deck${hasHighSynergy ? ` (Synergy: ${Math.round(synergy.score)}%)` : ''}`}
                  aria-label={`Add ${card.name} to deck${hasHighSynergy ? ` (Synergy: ${Math.round(synergy.score)}%)` : ''}`}
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

                  {hasHighSynergy && (
                    <div className="absolute top-2 right-2 z-10" data-testid="synergy-badge">
                      <Badge 
                        variant={synergy.score >= 80 ? "default" : "secondary"}
                        className={`${synergy.score >= 80 ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-500 hover:bg-orange-600'} text-white border-none shadow-sm text-[10px] px-1.5 py-0`}
                      >
                        {Math.round(synergy.score)}%
                      </Badge>
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      </ScrollArea>
    </div>
  );
});
