"use client";

import {
  useState,
  useTransition,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import type { ScryfallCard } from "@/app/actions";
import {
  initializeCardDatabase,
  getDatabaseStatus,
  searchCardsOffline,
  getAllCards,
  getCardById,
} from "@/lib/card-database";
import type { MinimalCard } from "@/lib/card-database";
import { type Format } from "@/lib/game-rules";
import { useCardFilters } from "@/hooks/use-card-filters";
import { useSearchPresets } from "@/hooks/use-search-presets";
import {
  QUICK_PRESETS,
  getPresetsByCategory,
  type QuickPreset,
} from "@/lib/search/quick-presets";
import {
  parseCardQuery,
  type QueryParseError,
} from "@/lib/search/query-parser";
import { cardSearchIndex } from "@/lib/search/card-search-index";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Search,
  Database,
  Loader2,
  X,
  Save,
  Trash2,
  HelpCircle,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useDebounce } from "use-debounce";
import { CardGridSkeleton } from "./card-grid-skeleton";
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
import { checkCardLegality } from "@/hooks/use-format-legality-check";
import { useSearchWorker } from "@/hooks/use-search-worker";
import { VirtualizedCardGrid } from "@/components/shared/virtualized-card-grid";
import type { VirtualizedCardGridHandle } from "@/components/shared/virtualized-card-grid";
import { CardResultTile } from "./card-result-tile";

interface CardSearchHandle {
  focus: () => void;
  /**
   * Pre-fill the search box with a query and run the search immediately.
   * Used by banned-card alternative suggestions to surface a replacement.
   */
  search: (query: string) => void;
}

interface CardSearchProps {
  onAddCard: (card: ScryfallCard) => void;
  /**
   * Called whenever the highlighted search result changes (including to null
   * when nothing is selected). Drives the page-level keyboard shortcuts that
   * operate on the "currently focused/selected" card (+, -, Enter).
   */
  onSelectedCardChange?: (card: ScryfallCard | null) => void;
  /**
   * Color identity of the deck's commander. When provided, enables the
   * "Match Commander Color Identity" filter toggle that restricts search
   * results to cards whose color identity fits within the commander's.
   */
  commanderColorIdentity?: string[];
  /**
   * Active deck format, used to evaluate per-card legality in the results
   * grid and to power the format-filter toggle.
   */
  format?: Format;
  /**
   * When true, cards that are not legal in `format` are hidden from the
   * search results entirely. Defaults to false (show everything with a
   * badge) so users can still discover banned / out-of-format cards.
   */
  formatFilter?: boolean;
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
    type_line: card.type_line || "",
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

export const CardSearch = forwardRef<CardSearchHandle, CardSearchProps>(
  function CardSearch({ onAddCard, onSelectedCardChange, commanderColorIdentity, format, formatFilter = false }, ref) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<ScryfallCard[]>([]);
    const [isPending, startTransition] = useTransition();
    const [isInitializing, setIsInitializing] = useState(true);
    const [dbStatus, setDbStatus] = useState<{
      loaded: boolean;
      cardCount: number;
    }>({ loaded: false, cardCount: 0 });
    const { toast } = useToast();

    // Off-main-thread search worker hook (issue #1389). The worker's
    // search proxy is used inside `searchCardsOffline`; `isReady` drives a
    // status badge so users can see when background search is active.
    const { isReady: isWorkerReady, status: workerStatus } = useSearchWorker();

    // "Match Commander Color Identity" filter toggle. Only has an effect when a
    // commander color identity is available.
    const [matchCommanderIdentity, setMatchCommanderIdentity] = useState(false);
    const canMatchCommanderIdentity =
      !!commanderColorIdentity && commanderColorIdentity.length > 0;

    // Power mode: when true, the search input is parsed as a structured
    // Scryfall-style query (issue #1440) instead of a fuzzy name search.
    // Defaults to off so the existing UX is preserved; the toggle is
    // opt-in.
    const [powerMode, setPowerMode] = useState(false);
    // Parsed query AST (kept in state so the error chip can react to
    // query edits without re-running the index). `null` until the user
    // types something.
    const [parsedQuery, setParsedQuery] = useState<ReturnType<
      typeof parseCardQuery
    > | null>(null);
    // Capture parse errors as a memoised array so the error chip can
    // re-render only when the list changes.
    const parseErrors: QueryParseError[] = parsedQuery?.errors ?? [];

    // Initialize filter hook for advanced filtering
    const {
      filters,
      setFilter,
      sortConfig,
      setSort,
      hasActiveFilters,
      search: filterSearch,
      resetFilters,
    } = useCardFilters();

    // Quick presets state
    const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
      null,
    );
    const presetsByCategory = getPresetsByCategory();

    // Saved search presets
    const {
      presets: savedPresets,
      isLoading: isLoadingPresets,
      savePreset,
      deletePreset,
    } = useSearchPresets();
    const [selectedSavedPresetId, setSelectedSavedPresetId] = useState<
      string | null
    >(null);
    const [isSavePresetDialogOpen, setIsSavePresetDialogOpen] = useState(false);
    const [newPresetName, setNewPresetName] = useState("");

    // Store all cards for filtering
    const [allCards, setAllCards] = useState<MinimalCard[]>([]);

    // Keyboard navigation state
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);

    // Flash state for visual feedback when card is added
    const [flashCardId, setFlashCardId] = useState<string | null>(null);

    // Virtualized grid handle. The VirtualizedCardGrid owns its own scroll
    // container and ResizeObserver-driven column count, so the deck-builder
    // card-search panel no longer needs a parent ref or a window-resize effect
    // to figure out how many columns to render. See issue #1246.
    const gridRef = useRef<VirtualizedCardGridHandle>(null);

    // Initial column count used until the grid's ResizeObserver fires on
    // mount. Three matches the previous default and keeps the first paint
    // visually consistent with the prior layout.
    const initialColumns = 3;

    // Trigger flash effect for a card
    const triggerFlash = useCallback((cardId: string) => {
      setFlashCardId(cardId);
      setTimeout(() => setFlashCardId(null), 400);
    }, []);

    // Expose focus method to parent
    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        search: (q: string) => {
          setQuery(q);
          inputRef.current?.focus();
        },
      }),
      [],
    );

    // Handle applying a quick preset
    const handleQuickPreset = useCallback(
      (presetId: string) => {
        if (presetId === "clear") {
          // Clear all filters
          resetFilters();
          setSelectedPresetId(null);
          return;
        }

        const preset = QUICK_PRESETS.find((p) => p.id === presetId);
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
      },
      [resetFilters, setFilter],
    );

    // Update selected preset when filters change externally
    useEffect(() => {
      if (!hasActiveFilters) {
        setSelectedPresetId(null);
        return;
      }

      // Check if current filters match any preset
      const match = QUICK_PRESETS.find((preset) => {
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
        await savePreset(
          newPresetName.trim(),
          filters,
          sortConfig.option,
          sortConfig.direction,
        );
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
    const handleLoadSavedPreset = useCallback(
      (presetId: string) => {
        const preset = savedPresets.find((p) => p.id === presetId);
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
            option: preset.sortOption || "name",
            direction: preset.sortDirection || "asc",
          });
        }

        setSelectedSavedPresetId(presetId);
        setSelectedPresetId(null); // Clear quick preset selection
      },
      [savedPresets, resetFilters, setFilter, setSort],
    );

    // Handle deleting a saved preset
    const handleDeleteSavedPreset = useCallback(
      async (presetId: string, e: React.MouseEvent) => {
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
      },
      [deletePreset, selectedSavedPresetId, toast],
    );

    // Handle keyboard navigation in search results
    const handleSearchKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (results.length === 0) return;

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setSelectedIndex((prev) =>
              prev < results.length - 1 ? prev + 1 : 0,
            );
            break;
          case "ArrowUp":
            e.preventDefault();
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : results.length - 1,
            );
            break;
          case "Enter":
            e.preventDefault();
            if (selectedIndex >= 0 && results[selectedIndex]) {
              onAddCard(results[selectedIndex]);
            }
            break;
        }
      },
      [results, selectedIndex, onAddCard],
    );

    // Reset selectedIndex when results change
    useEffect(() => {
      setSelectedIndex(-1);
    }, [results]);

    // Report the currently highlighted card to the parent for keyboard shortcuts.
    useEffect(() => {
      onSelectedCardChange?.(
        selectedIndex >= 0 ? (results[selectedIndex] ?? null) : null,
      );
    }, [selectedIndex, results, onSelectedCardChange]);

    // Scroll selected card into view using the VirtualizedCardGrid's
    // imperative handle. The grid maps the flat item index to a row index
    // internally so callers keep passing the card index directly.
    useEffect(() => {
      if (selectedIndex >= 0) {
        gridRef.current?.scrollToIndex(selectedIndex);
      }
    }, [selectedIndex]);

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

    // Re-parse the query on every edit when Power mode is on so the
    // inline error chip stays in sync with what the user typed. The
    // parser is pure and cheap (<1ms) so we run it inline.
    useEffect(() => {
      if (!powerMode) {
        setParsedQuery(null);
        return;
      }
      setParsedQuery(parseCardQuery(debouncedQuery));
    }, [debouncedQuery, powerMode]);

    // Apply search and filtering when query or filters change
    useEffect(() => {
      if (!dbStatus.loaded) return;

      startTransition(async () => {
        let searchResults: ScryfallCard[];

        if (debouncedQuery.length >= 2) {
          if (powerMode) {
            // Power mode: route through the structured parser, then
            // the Orama `where` clause directly. The hook would add
            // another debounce layer we don't need here because the
            // outer `useDebounce` already smooths typing.
            const parsed = parseCardQuery(debouncedQuery);
            // If the parser bailed out (e.g. unbalanced quotes), keep
            // the existing results rather than flashing an empty grid.
            if (parsed.errors.some((e) => /Unbalanced quote/.test(e.message))) {
              // Do nothing — preserve previous results.
              return;
            }
            const hits = await cardSearchIndex.search(parsed.term, {
              where: parsed.where,
              limit: 50,
            });
            const cards: MinimalCard[] = [];
            for (const hit of hits) {
              const card = await getCardById(hit.id);
              if (card) cards.push(card);
              if (cards.length >= 50) break;
            }
            searchResults = cards as unknown as ScryfallCard[];
          } else {
            // Fuzzy mode (default): existing offline name search.
            searchResults = (await searchCardsOffline(debouncedQuery, {
              maxCards: 50,
              format: "commander" as Format,
              includeImages: true,
            })) as ScryfallCard[];
          }
        } else {
          // No query - get a subset of cards or empty
          searchResults = [];
        }

        // Optional: restrict results to the commander's color identity.
        if (matchCommanderIdentity && canMatchCommanderIdentity) {
          const allowed = new Set(commanderColorIdentity);
          searchResults = searchResults.filter((card) => {
            const identity = card.color_identity || [];
            // Colorless cards (empty identity) are always allowed.
            return identity.every((c) => allowed.has(c));
          });
        }

        // Apply additional filters from the hook if active
        if (hasActiveFilters && searchResults.length > 0) {
          // Convert to MinimalCard for filtering
          const minimalCards = searchResults.map(toMinimalCard);

          // Apply filters and sorting using the hook
          const filtered = await filterSearch(debouncedQuery, minimalCards);

          // Get IDs of filtered cards
          const filteredIds = new Set(filtered.map((c) => c.id));

          // Keep only filtered results
          searchResults = searchResults.filter((card) =>
            filteredIds.has(card.id),
          );
        }

        // Format legality filter: when the toggle is on, drop any card whose
        // `legalities[format]` is not 'legal' or 'restricted'. This makes the
        // search results reflect only format-playable cards.
        if (formatFilter && format && searchResults.length > 0) {
          searchResults = searchResults.filter((card) => {
            const result = checkCardLegality(card, format, format);
            return !result.isIllegal;
          });
        }

        setResults(searchResults);
      });
    }, [
      debouncedQuery,
      filters,
      sortConfig,
      dbStatus.loaded,
      hasActiveFilters,
      filterSearch,
      matchCommanderIdentity,
      canMatchCommanderIdentity,
      commanderColorIdentity,
      format,
      formatFilter,
      powerMode,
    ]);

    const { synergyData } = useSynergy();

    // Stable callbacks for the memoized CardResultTile. `handleAddCard`
    // preserves the legacy shift-click-for-4 behaviour that used to live
    // inside the inline cell render.
    const handleAddCard = useCallback(
      (card: ScryfallCard, shift: boolean) => {
        triggerFlash(card.id);
        if (shift) {
          const MAX_QUICK_ADD = 4;
          for (let i = 0; i < MAX_QUICK_ADD; i++) {
            onAddCard(card);
          }
        } else {
          onAddCard(card);
        }
      },
      [onAddCard, triggerFlash],
    );

    const handleSelect = useCallback((index: number) => {
      setSelectedIndex(index);
    }, []);

    // Cell renderer. Wrapped in useCallback so the VirtualizedCardGrid
    // doesn't see a new `renderItem` reference on every parent render —
    // this is the linchpin of the React.memo short-circuit on
    // CardResultTile. The visible-row window is rebuilt by the virtualizer
    // itself, not by us, so this callback only fires for the small slice of
    // rows in the current viewport.
    const renderResult = useCallback(
      (card: ScryfallCard, index: number) => (
        <CardResultTile
          card={card}
          index={index}
          isSelected={selectedIndex === index}
          isFlashing={flashCardId === card.id}
          synergy={synergyData.get(card.id)}
          format={format}
          hideLegality={formatFilter}
          onAddCard={handleAddCard}
          onSelect={handleSelect}
        />
      ),
      [
        selectedIndex,
        flashCardId,
        synergyData,
        format,
        formatFilter,
        handleAddCard,
        handleSelect,
      ],
    );

    return (
      <div
        className="flex flex-col h-full"
        role="search"
        aria-label="Card search"
      >
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
            <span
              className="text-xs text-muted-foreground"
              data-search-worker-status={workerStatus}
            >
              {isWorkerReady ? "Background search" : "Offline ready"}
            </span>
          )}
        </div>

        {/* Search Input and Quick Filters */}
        <div className="space-y-3 mb-4">
          {/* Search Input */}
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={inputRef}
              type="search"
              placeholder={
                powerMode
                  ? "Power search — e.g. 'c:red t:instant cmc<=3'"
                  : "Search for cards (e.g., 'Sol Ring') + Ctrl+F"
              }
              className="pl-10"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-label={
                powerMode
                  ? "Power card search (Scryfall-style syntax)"
                  : "Search cards by name"
              }
              aria-describedby="search-hint"
              disabled={isInitializing}
              data-testid="card-search-input"
            />
          </div>

          {/* Power mode toggle + syntax help. Issue #1440 surfaces the
              Scryfall-style query language behind a single opt-in
              toggle. Off by default so the existing fuzzy UX is
              preserved. */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Switch
                id="power-search-toggle"
                checked={powerMode}
                onCheckedChange={(checked) => {
                  setPowerMode(checked === true);
                  if (!checked) {
                    // Reset parse state so the error chip fades out.
                    setParsedQuery(null);
                  }
                }}
                data-testid="power-search-toggle"
                aria-label="Enable power search syntax"
              />
              <Label
                htmlFor="power-search-toggle"
                className="text-xs cursor-pointer"
              >
                Power search
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:bg-muted"
                    aria-label="Show power search syntax help"
                    data-testid="power-search-syntax-help"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="max-w-[320px] text-xs space-y-2"
                >
                  <p className="font-medium text-foreground">
                    Scryfall-style syntax
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>
                      <code className="text-foreground">c:red</code>,{" "}
                      <code className="text-foreground">c:wubrg</code> — color
                      inclusion (OR semantics)
                    </li>
                    <li>
                      <code className="text-foreground">
                        t:instant,sorcery
                      </code>{" "}
                      — type inclusion
                    </li>
                    <li>
                      <code className="text-foreground">
                        cmc&lt;=3
                      </code>{""},{" "}
                      <code className="text-foreground">cmc&gt;=4</code>,{" "}
                      <code className="text-foreground">cmc=2</code>,{" "}
                      <code className="text-foreground">mv:5</code> —
                      mana-value comparisons
                    </li>
                    <li>
                      <code className="text-foreground">s:mh2</code> — set
                      code
                    </li>
                    <li>Free words: matched against name, type, oracle text</li>
                  </ul>
                  <p className="text-muted-foreground">
                    Examples:{" "}
                    <code className="text-foreground">
                      c:red t:instant cmc&lt;=3
                    </code>{" "}
                    ·{" "}
                    <code className="text-foreground">
                      c:wubrg t:creature
                    </code>
                  </p>
                </PopoverContent>
              </Popover>
            </div>
            {powerMode && parseErrors.length > 0 && (
              <span
                role="status"
                aria-live="polite"
                data-testid="power-search-parse-error"
                className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
              >
                <AlertCircle className="h-3 w-3" />
                {parseErrors[0]?.message}
              </span>
            )}
          </div>

          {/* Quick Presets Dropdown */}
          <div className="flex items-center gap-2">
            <Select
              value={selectedPresetId || ""}
              onValueChange={handleQuickPreset}
            >
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
              disabled={
                isInitializing || isLoadingPresets || savedPresets.length === 0
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Load saved preset" />
              </SelectTrigger>
              <SelectContent>
                {savedPresets.map((preset) => (
                  <SelectItem
                    key={preset.id}
                    value={preset.id}
                    className="flex items-center justify-between"
                  >
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
              <span className="text-xs text-muted-foreground">
                No saved presets
              </span>
            )}

            {/* Match Commander Color Identity filter toggle */}
            {canMatchCommanderIdentity && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="match-commander-identity"
                  checked={matchCommanderIdentity}
                  onCheckedChange={(checked) => setMatchCommanderIdentity(checked === true)}
                  data-testid="match-commander-identity-checkbox"
                />
                <Label
                  htmlFor="match-commander-identity"
                  className="text-xs cursor-pointer"
                  title={`Only show cards within commander's color identity (${commanderColorIdentity!.join("/")})`}
                >
                  Match Commander Color Identity ({commanderColorIdentity!.join("")})
                </Label>
              </div>
            )}
          </div>
        </div>

        {/* Save Preset Dialog */}
        <Dialog
          open={isSavePresetDialogOpen}
          onOpenChange={setIsSavePresetDialogOpen}
        >
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
                  if (e.key === "Enter") {
                    handleSavePreset();
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsSavePresetDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleSavePreset}>Save Preset</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Search Results - Virtualized for performance */}
        <div
          className="flex-grow rounded-lg border bg-card overflow-hidden"
          role="list"
          aria-label="Search results"
        >
          {/* Loading state */}
          {isInitializing && (
            <div className="p-4">
              <div className="text-center text-muted-foreground py-10">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p>Initializing offline card database...</p>
              </div>
              <CardGridSkeleton />
            </div>
          )}

          {/* Pending state */}
          {!isInitializing && isPending && (
            <div className="p-4">
              <CardGridSkeleton />
            </div>
          )}

          {/* Empty results state */}
          {!isInitializing && !isPending && results.length === 0 && (
            <div
              className="text-center text-muted-foreground py-10 px-4"
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
                    Search results come from your offline card database. The
                    current database contains essential commander cards. More
                    cards can be added via bulk import in future updates.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Virtualized card grid — owns its own scroll container. */}
          {!isInitializing && !isPending && results.length > 0 && (
            <VirtualizedCardGrid
              ref={gridRef}
              items={results}
              columns={initialColumns}
              itemHeight={280}
              renderItem={renderResult}
              gap={16}
              overscan={5}
            />
          )}
        </div>
      </div>
    );
  },
);
