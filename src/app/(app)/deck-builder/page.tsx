"use client";

import {
  useState,
  useTransition,
  useEffect,
  useRef,
  useCallback,
  Suspense,
  useMemo,
} from "react";
import dynamic from "next/dynamic";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ScryfallCard, DeckCard, SavedDeck } from "@/app/actions";
import {
  importDecklistClient,
  type ImportDeckResult,
} from "@/lib/client-card-operations";
import { type DecklistFormat } from "@/lib/decklist-utils";
import {
  formatRules,
  formatUsesSideboard,
  getCommanderFromDeck,
  getGameModeIdFromFormatName,
  getSideboardSize,
  validateDeckFormat,
  getFormatDisplayName,
  validateStandardRotation,
  type Format,
  type BannedCardSuggestion,
} from "@/lib/game-rules";
import {
  useFormatLegalityCheck,
  checkCardLegality,
} from "@/hooks/use-format-legality-check";
import { CardSearch } from "./_components/card-search";
import { CardGridSkeleton } from "./_components/card-grid-skeleton";
import { DeckBuilderSkeleton } from "./_components/deck-builder-skeleton";
import { DeckList } from "./_components/deck-list";
import { SideboardList } from "./_components/sideboard-list";
import { ImportExportControls } from "./_components/import-export-controls";
import { useDeckBuilderShortcuts } from "./_lib/use-deck-builder-shortcuts";
import { BannedCardAlternatives } from "./_components/banned-card-alternatives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { deleteConversationsForDeck } from "@/lib/coach-conversation-storage";
import { SavedDecksList } from "./_components/saved-decks-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SynergyProvider } from "./_components/synergy-context";
import { DeckStatsPanel } from "./_components/deck-stats-panel";
import { ManaCurveAnalysis } from "@/components/meta/mana-curve";
import { GoldfishSimulator } from "./_components/goldfish-simulator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComponentErrorBoundary } from "@/components/error-boundaries";

// Lazy-load the AI deck assistant so @ai-sdk/react and its chat UI are split
// into a separate chunk and only loaded when the deck-builder renders.
// (Issue #1022)
const AIDeckAssistant = dynamic(
  () =>
    import("./_components/ai-deck-assistant").then((m) => m.AIDeckAssistant),
  {
    ssr: false,
    loading: () => null,
  },
);

// Stable reference so useLocalStorage's effect deps don't change every render
// (an inline [] would re-trigger the load effect on each render, leaving the
// loading flag permanently true because each run's cleanup invalidates the
// previous one before it can call setLoading(false)).
const EMPTY_DECKS: SavedDeck[] = [];

export default function DeckBuilderPage() {
  const [deck, setDeck] = useState<DeckCard[]>([]);
  /**
   * Constructed-format sideboard pool. Empty for Commander-family formats
   * (they don't have a sideboard per the format rules). See issue #1402.
   */
  const [sideboard, setSideboard] = useState<DeckCard[]>([]);
  const [deckName, setDeckName] = useState("New Deck");
  const [format, setFormat] = useState<Format>("commander");
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [isDeckSaved, setIsDeckSaved] = useState(false);
  const [savedDecksRaw, setSavedDecks, { loading: decksLoading }] =
    useLocalStorage<SavedDeck[]>("saved-decks", EMPTY_DECKS);
  // Defensive: ensure savedDecks is always an array (guards against corrupted storage)
  const savedDecks = Array.isArray(savedDecksRaw) ? savedDecksRaw : [];
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  // The card currently highlighted in CardSearch — the target for the +, - and
  // Enter shortcuts. Lifted from CardSearch so the page-level keydown listener
  // (installed by useDeckBuilderShortcuts) can act on it.
  const [selectedCard, setSelectedCard] = useState<ScryfallCard | null>(null);
  // When true, the card search hides any card that is not legal in the
  // active format. Off by default so users can still browse the full pool.
  const [formatFilter, setFormatFilter] = useState(false);
  // Bumped by the `H` shortcut to request a fresh Hand Test opening hand in the
  // goldfish simulator (issue #1439). The component re-runs on each change.
  const [handTestDrawSignal, setHandTestDrawSignal] = useState(0);
  const searchInputRef = useRef<{
    focus: () => void;
    search: (q: string) => void;
  }>(null);

  const { toast } = useToast();
  const [isImporting, startImportTransition] = useTransition();

  // Derive the commander from the deck (first legendary creature). The color
  // identity drives the deck-list violation highlighting and the search
  // "Match Commander Color Identity" filter. Color identity enforcement only
  // applies to commander-family formats.
  const isCommanderFormat =
    format === "commander" || format === "legendary-commander";
  const commander = useMemo(
    () => (isCommanderFormat ? getCommanderFromDeck(deck) : undefined),
    [deck, isCommanderFormat],
  );
  const commanderColorIdentity = commander?.color_identity;
  // Human-readable label for the active format, reused across legality
  // messages so toasts/badges stay consistent with the format selector.
  const formatLabel = getFormatDisplayName(format);
  const legalitySummary = useFormatLegalityCheck(deck, format, formatLabel);
  // Standard rotation awareness: when editing a Standard ("constructed-core")
  // deck, flag cards whose set has rotated out of legality. Surfaces warnings
  // from validateStandardRotation so users can swap rotated cards. See
  // src/lib/game-rules.ts and docs/standard-rotation.md.
  const rotationWarnings = useMemo(() => {
    const gameModeId = getGameModeIdFromFormatName(format);
    if (gameModeId !== "constructed-core" && format !== "standard") {
      return [] as string[];
    }
    if (deck.length === 0) return [] as string[];
    return validateStandardRotation(deck).warnings;
  }, [format, deck]);

  useEffect(() => {
    // If there is an active deck, check if it's "dirty"
    if (activeDeckId) {
      const activeDeck = savedDecks.find((d) => d.id === activeDeckId);
      if (activeDeck) {
        const isNameChanged = activeDeck.name !== deckName;
        const isFormatChanged = activeDeck.format !== format;
        const isCardsChanged =
          JSON.stringify(
            activeDeck.cards
              .map((c) => ({ id: c.id, count: c.count }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          ) !==
          JSON.stringify(
            deck
              .map((c) => ({ id: c.id, count: c.count }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          );
        // Sideboard round-trips per #1402; pre-#1402 SavedDecks have no
        // sideboard field so we compare against [] in that case.
        const activeSideboard = activeDeck.sideboard ?? [];
        const isSideboardChanged =
          JSON.stringify(
            activeSideboard
              .map((c) => ({ id: c.id, count: c.count }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          ) !==
          JSON.stringify(
            sideboard
              .map((c) => ({ id: c.id, count: c.count }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          );

        setIsDeckSaved(
          !isNameChanged &&
            !isFormatChanged &&
            !isCardsChanged &&
            !isSideboardChanged,
        );
      }
    } else {
      // New deck is never "saved"
      setIsDeckSaved(false);
    }
  }, [deck, sideboard, deckName, format, activeDeckId, savedDecks]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveDeck();
      }
      // Ctrl+F or Cmd+F to focus search
      else if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Escape to close dialogs (handled by Dialog component, but we track state)
      else if (e.key === "Escape") {
        setIsImportDialogOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // Empty deps - handlers are stable

  const handleDeckChange = useCallback(
    (updater: (prevDeck: DeckCard[]) => DeckCard[]) => {
      setDeck(updater);
      setIsDeckSaved(false);
    },
    [],
  );

  const handleDeckNameChange = (name: string) => {
    setDeckName(name);
    setIsDeckSaved(false);
  };

  const handleFormatChange = (newFormat: Format) => {
    setFormat(newFormat);
    setIsDeckSaved(false);
  };

  const addCardToDeck = useCallback(
    (card: ScryfallCard) => {
      const gameModeId = getGameModeIdFromFormatName(format);
      const rules = formatRules[gameModeId as keyof typeof formatRules];

      // Format legality guard: refuse to add cards that are banned or simply
      // not part of the active format's pool. We surface the exact reason via
      // toast so the user understands why the add was blocked. Restricted
      // cards are allowed through; the existing max-copies rule below still
      // caps them at one.
      const legality = checkCardLegality(card, format, formatLabel);
      if (legality.isIllegal) {
        toast({
          variant: "destructive",
          title:
            legality.status === "banned"
              ? "Banned Card"
              : "Format-Illegal Card",
          description: `${legality.reason} It cannot be added to a ${formatLabel} deck.`,
        });
        return;
      }

      handleDeckChange((prevDeck) => {
        const existingCard = prevDeck.find((c) => c.id === card.id);
        const isBasicResource = card.type_line?.includes("Basic Resource");

        if (
          !isBasicResource &&
          existingCard &&
          existingCard.count >= rules.maxCopies
        ) {
          toast({
            variant: "destructive",
            title: "Card Limit Reached",
            description: `You can only have ${rules.maxCopies} cop${rules.maxCopies > 1 ? "ies" : "y"} of "${card.name}" in a ${format} deck.`,
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
            c.id === card.id ? { ...c, count: c.count + 1 } : c,
          );
        } else {
          return [...prevDeck, { ...card, count: 1 }];
        }
      });
    },
    [format, handleDeckChange, toast],
  );

  const removeCardFromDeck = useCallback(
    (cardId: string) => {
      handleDeckChange((prevDeck) => {
        const existingCard = prevDeck.find((c) => c.id === cardId);
        if (existingCard && existingCard.count > 1) {
          return prevDeck.map((c) =>
            c.id === cardId ? { ...c, count: c.count - 1 } : c,
          );
        } else {
          return prevDeck.filter((c) => c.id !== cardId);
        }
      });
    },
    [handleDeckChange],
  );

  const clearDeck = useCallback(() => {
    setDeck([]);
    setSideboard([]);
    setDeckName("New Deck");
    setActiveDeckId(null);
    toast({
      title: "Deck Cleared",
      description: "Your deck has been emptied.",
    });
  }, [toast]);

  // Maximum copies added by the "Shift++" (add max) shortcut. Matches the
  // Shift+Click quick-add behaviour in CardSearch.
  const MAX_QUICK_ADD = 4;

  const handleShortcutAdd = useCallback(
    (card: ScryfallCard, max: boolean) => {
      const copies = max ? MAX_QUICK_ADD : 1;
      for (let i = 0; i < copies; i++) addCardToDeck(card);
    },
    [addCardToDeck],
  );

  const handleShortcutRemove = useCallback(
    (card: ScryfallCard, all: boolean) => {
      if (all) {
        handleDeckChange((prev) => prev.filter((c) => c.id !== card.id));
      } else {
        removeCardFromDeck(card.id);
      }
    },
    [removeCardFromDeck, handleDeckChange],
  );

  // Whether the active format supports a sideboard (Modern/Standard/etc).
  // The flag drives the Sideboard tab visibility, the sideboard-array
  // round-trip and the JSON export.
  const supportsSideboard = formatUsesSideboard(format);
  const sideboardMaxSize = getSideboardSize(format);

  /**
   * Increments one copy of a card in the sideboard, enforcing both the
   * per-card copy limit (rules.maxCopies, e.g. 4) and the format's
   * sideboardSize cap. Mirrors the addCardToDeck toast pattern so the user
   * gets the same descriptive feedback. See issue #1402.
   */
  const addCardToSideboard = useCallback(
    (card: ScryfallCard) => {
      if (!supportsSideboard) return;

      const gameModeId = getGameModeIdFromFormatName(format);
      const rules = formatRules[gameModeId as keyof typeof formatRules];

      const legality = checkCardLegality(card, format, formatLabel);
      if (legality.isIllegal) {
        toast({
          variant: "destructive",
          title:
            legality.status === "banned"
              ? "Banned Card"
              : "Format-Illegal Card",
          description: `${legality.reason} It cannot be added to a ${formatLabel} sideboard.`,
        });
        return;
      }

      setSideboard((prevSideboard) => {
        const existingCard = prevSideboard.find((c) => c.id === card.id);
        const isBasicResource = card.type_line?.includes("Basic Resource");

        if (
          !isBasicResource &&
          existingCard &&
          existingCard.count >= rules.maxCopies
        ) {
          toast({
            variant: "destructive",
            title: "Card Limit Reached",
            description: `You can only have ${rules.maxCopies} cop${rules.maxCopies > 1 ? "ies" : "y"} of "${card.name}" in a sideboard.`,
          });
          return prevSideboard;
        }

        const totalCards = prevSideboard.reduce((sum, c) => sum + c.count, 0);
        if (sideboardMaxSize > 0 && totalCards >= sideboardMaxSize) {
          toast({
            variant: "destructive",
            title: "Sideboard Limit Reached",
            description: `A ${formatLabel} sideboard cannot have more than ${sideboardMaxSize} cards.`,
          });
          return prevSideboard;
        }

        if (existingCard) {
          return prevSideboard.map((c) =>
            c.id === card.id ? { ...c, count: c.count + 1 } : c,
          );
        }
        return [...prevSideboard, { ...card, count: 1 }];
      });
      setIsDeckSaved(false);
    },
    [supportsSideboard, format, formatLabel, sideboardMaxSize, toast],
  );

  /**
   * Decrement one copy of a card from the sideboard, removing the row
   * entirely when the count reaches zero. Mirrors `removeCardFromDeck`.
   */
  const removeCardFromSideboard = useCallback((cardId: string) => {
    setSideboard((prevSideboard) => {
      const existingCard = prevSideboard.find((c) => c.id === cardId);
      if (existingCard && existingCard.count > 1) {
        return prevSideboard.map((c) =>
          c.id === cardId ? { ...c, count: c.count - 1 } : c,
        );
      }
      return prevSideboard.filter((c) => c.id !== cardId);
    });
    setIsDeckSaved(false);
  }, []);

  // Ctrl/Cmd+N — documented as "New Deck". Wraps clearDeck so a future confirm
  // prompt can be added in one place.
  const handleNewDeck = useCallback(() => clearDeck(), [clearDeck]);

  // H — documented as "Draw another opening hand" for the Hand Test tab. Bumps
  // a signal the GoldfishSimulator consumes to re-run with a fresh seed.
  const handleDrawSample = useCallback(
    () => setHandTestDrawSignal((n) => n + 1),
    [],
  );

  // Documented deck-builder shortcuts: +, -, Shift++/Shift+-, Enter,
  // Ctrl/Cmd+N, H (Hand Test).
  useDeckBuilderShortcuts({
    selectedCard,
    addCard: handleShortcutAdd,
    removeCard: handleShortcutRemove,
    newDeck: handleNewDeck,
    drawSample: handleDrawSample,
  });

  // Detect banned cards in the current deck and surface curated legal
  // substitutes. Recomputed whenever the deck or format changes.
  const bannedCardSuggestions: BannedCardSuggestion[] = useMemo(() => {
    if (deck.length === 0) return [];
    const deckCards = deck.map((card) => ({
      name: card.name,
      count: card.count,
      color_identity: card.color_identity,
      type_line: card.type_line,
    }));
    const result = validateDeckFormat(deckCards, format);
    return result.bannedCardSuggestions ?? [];
  }, [deck, format]);

  // One-click action for a suggested alternative: pre-fill the card search
  // box so the user can review the replacement and add it on confirm. This
  // satisfies the "add to deck or search for it" acceptance criterion.
  const handleSelectAlternative = useCallback(
    (cardName: string) => {
      searchInputRef.current?.search(cardName);
      toast({
        title: "Searching for alternative",
        description: `Showing results for "${cardName}".`,
      });
    },
    [toast],
  );

  const importDeck = (
    decklist: string,
    decklistFormat?: DecklistFormat,
  ): Promise<ImportDeckResult | null> => {
    if (!decklist.trim()) {
      toast({
        variant: "destructive",
        title: "Empty Decklist",
        description: "Please paste a decklist to import.",
      });
      return Promise.resolve(null);
    }
    setActiveDeckId(null);
    return new Promise<ImportDeckResult | null>((resolve) => {
      startImportTransition(async () => {
        try {
          const result = await importDecklistClient(
            decklist,
            decklistFormat,
            format,
          );
          const { found, notFound, illegal } = result;

          if (found.length > 0) {
            setDeck(found);
            toast({
              title: "Deck Imported",
              description: `Successfully added ${result.successCount} cards.`,
            });
          } else {
            toast({
              variant: "destructive",
              title: "Import Failed",
              description: "No cards from your list could be found or added.",
            });
          }

          if (notFound.length > 0) {
            toast({
              variant: "destructive",
              title: "Cards Not Found",
              description: `${notFound.length} cards were not found in your local database. You may need to update your database or check for typos. Missing: ${notFound.slice(0, 5).join(", ")}${notFound.length > 5 ? "..." : ""}`,
            });
          }

          if (illegal.length > 0) {
            toast({
              title: "Illegal Cards Skipped",
              description: `${illegal.length} cards are not legal in ${format} and were skipped. Illegal: ${illegal.slice(0, 5).join(", ")}${illegal.length > 5 ? "..." : ""}`,
            });
          }

          resolve(result);
        } catch (error) {
          console.error(error);
          toast({
            variant: "destructive",
            title: "Import Error",
            description:
              "An unexpected error occurred while importing the deck.",
          });
          resolve(null);
        }
      });
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
      .map((card) => `${card.count} ${card.name}`)
      .join("\n");

    const blob = new Blob([decklist], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deckName.replace(/\s/g, "_")}.txt`;
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
      toast({ variant: "destructive", title: "Cannot Save Empty Deck" });
      return;
    }
    const now = new Date().toISOString();
    if (activeDeckId) {
      // Update existing deck
      const updatedDecks = savedDecks.map((d) =>
        d.id === activeDeckId
          ? {
              ...d,
              name: deckName,
              format,
              cards: deck,
              sideboard,
              updatedAt: now,
            }
          : d,
      );
      setSavedDecks(updatedDecks);
      toast({
        title: "Deck Updated",
        description: `"${deckName}" has been updated.`,
      });
    } else {
      // Create new deck
      const newDeck: SavedDeck = {
        id: crypto.randomUUID(),
        name: deckName,
        format,
        cards: deck,
        sideboard,
        createdAt: now,
        updatedAt: now,
      };
      setSavedDecks([...savedDecks, newDeck]);
      setActiveDeckId(newDeck.id);
      toast({
        title: "Deck Saved",
        description: `"${deckName}" has been saved.`,
      });
    }
    setIsDeckSaved(true);
  };

  const loadDeck = (deckToLoad: SavedDeck) => {
    setDeck(deckToLoad.cards);
    // Pre-#1402 SavedDecks have no sideboard field — fall back to an empty
    // pool so the round-trip is non-destructive for legacy payloads.
    setSideboard(deckToLoad.sideboard ?? []);
    setDeckName(deckToLoad.name);
    setFormat(deckToLoad.format);
    setActiveDeckId(deckToLoad.id);
    toast({
      title: "Deck Loaded",
      description: `Now editing "${deckToLoad.name}".`,
    });
  };

  const deleteDeck = (deckId: string) => {
    setSavedDecks(savedDecks.filter((d) => d.id !== deckId));
    if (activeDeckId === deckId) {
      clearDeck();
    }
    // Prune any coach sessions that were scoped to the deleted deck so the
    // IndexedDB store doesn't accumulate orphaned transcripts (issue #1242).
    // Fire-and-forget — the toast below surfaces success regardless of the
    // async result so the UI never blocks on storage I/O.
    void deleteConversationsForDeck(deckId).catch((error) => {
      console.error("Failed to prune orphan coach sessions:", error);
    });
    toast({ title: "Deck Deleted" });
  };

  // While saved decks (and other IndexedDB-backed state) hydrate on first
  // navigation, show a layout-stable skeleton instead of a blank screen.
  if (decksLoading) {
    return <DeckBuilderSkeleton />;
  }

  return (
    <SynergyProvider deck={deck}>
      <div className="flex h-full min-h-svh w-full flex-col p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <h1 className="font-headline text-3xl font-bold whitespace-nowrap">
              Deck Builder
            </h1>
            <div className="flex items-center gap-2">
              <Label htmlFor="format-select" className="text-muted-foreground">
                Format
              </Label>
              <Select value={format} onValueChange={handleFormatChange}>
                <SelectTrigger
                  id="format-select"
                  data-testid="format-select"
                  className="w-40 capitalize"
                >
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
              {/* Format Filter toggle: hides cards that are not legal in the
                  active format from search results. Helps users stay on-pool
                  while building. */}
              <label
                htmlFor="format-filter-toggle"
                className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none"
              >
                <Switch
                  id="format-filter-toggle"
                  checked={formatFilter}
                  onCheckedChange={setFormatFilter}
                  data-testid="format-filter-toggle"
                />
                Format Filter
              </label>
            </div>
          </div>
          <ImportExportControls
            onImport={importDeck}
            onExport={exportDeck}
            onClear={clearDeck}
            onSave={saveDeck}
            isDeckSaved={isDeckSaved}
            isImporting={isImporting}
            deckName={deckName}
            deckCards={deck.map((card) => ({
              name: card.name,
              quantity: card.count,
            }))}
            sideboardCards={sideboard.map((card) => ({
              name: card.name,
              quantity: card.count,
            }))}
            format={format}
          />
        </div>
        <div className="flex-grow grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-2">
            <ComponentErrorBoundary
              title="Card Search Error"
              description="The card search failed to load. Try again to resume searching for cards."
            >
              <Suspense fallback={<CardGridSkeleton className="p-4" />}>
                <CardSearch
                  ref={searchInputRef}
                  onAddCard={addCardToDeck}
                  onSelectedCardChange={setSelectedCard}
                  commanderColorIdentity={commanderColorIdentity}
                  format={format}
                  formatFilter={formatFilter}
                />
              </Suspense>
            </ComponentErrorBoundary>
          </div>
          <div className="lg:col-span-1 flex flex-col gap-6">
            {rotationWarnings.length > 0 && (
              <Alert variant="warning" data-testid="rotation-warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Standard rotation warning</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-1">
                    {rotationWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <Tabs defaultValue="deck" className="w-full">
              <TabsList
                className={cn(
                  "w-full",
                  supportsSideboard ? "grid grid-cols-4" : "grid grid-cols-3",
                )}
                data-testid="deck-builder-tabs"
              >
                <TabsTrigger value="deck" className="flex-1">
                  Deck List
                </TabsTrigger>
                <TabsTrigger value="mana-curve" className="flex-1">
                  Mana Curve
                </TabsTrigger>
                <TabsTrigger value="hand-test" className="flex-1">
                  Hand Test
                </TabsTrigger>
                {supportsSideboard && (
                  <TabsTrigger
                    value="sideboard"
                    className="flex-1"
                    data-testid="sideboard-tab-trigger"
                  >
                    Sideboard
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="deck" className="mt-4">
                <ComponentErrorBoundary
                  title="Deck List Error"
                  description="Your deck list failed to render. Your cards are saved — try reloading the list."
                >
                  <DeckList
                    deck={deck}
                    deckName={deckName}
                    onDeckNameChange={handleDeckNameChange}
                    onRemoveCard={removeCardFromDeck}
                    onAddCard={addCardToDeck}
                    commanderColorIdentity={commanderColorIdentity}
                    cardLegality={legalitySummary.cards}
                  />
                </ComponentErrorBoundary>
              </TabsContent>
              <TabsContent value="mana-curve" className="mt-4">
                {deck.length > 0 ? (
                  <ManaCurveAnalysis deck={deck} />
                ) : (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      Add cards to your deck to see mana curve analysis
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="hand-test" className="mt-4">
                <ComponentErrorBoundary
                  title="Hand Test Error"
                  description="The goldfish simulator failed to render. Your deck is saved — try reloading the Hand Test tab."
                >
                  <GoldfishSimulator
                    deck={deck}
                    sideboard={sideboard}
                    format={format}
                    drawTrigger={handTestDrawSignal}
                  />
                </ComponentErrorBoundary>
              </TabsContent>
              {supportsSideboard && (
                <TabsContent value="sideboard" className="mt-4">
                  <ComponentErrorBoundary
                    title="Sideboard List Error"
                    description="The sideboard list failed to render. Your cards are saved — try reloading the sideboard tab."
                  >
                    <SideboardList
                      sideboard={sideboard}
                      maxSize={sideboardMaxSize}
                      onRemoveCard={removeCardFromSideboard}
                      onAddCard={addCardToSideboard}
                    />
                  </ComponentErrorBoundary>
                </TabsContent>
              )}
            </Tabs>
          </div>
          <div className="lg:col-span-1 flex flex-col gap-6">
            {bannedCardSuggestions.length > 0 && (
              <BannedCardAlternatives
                suggestions={bannedCardSuggestions}
                onSelectAlternative={handleSelectAlternative}
              />
            )}
            <AIDeckAssistant deck={deck} onAddCard={addCardToDeck} />
            <DeckStatsPanel
              deck={deck}
              format={format}
              formatLabel={formatLabel}
              legalitySummary={legalitySummary}
            />
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-lg">Saved Decks</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <SavedDecksList
                  savedDecks={savedDecks}
                  onLoadDeck={loadDeck}
                  onDeleteDeck={deleteDeck}
                  activeDeckId={activeDeckId}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </SynergyProvider>
  );
}
