/**
 * Limited Deck Builder Page
 *
 * Phase 14: Foundation
 * Requirements: LBld-01, LBld-02, LBld-03, LBld-04, LBld-05, LBld-06
 *
 * Features:
 * - Build deck from sealed pool only (LBld-01, LBld-02)
 * - 40-card minimum validation (LBld-03)
 * - 4-copy limit enforcement (LBld-04)
 * - No sideboard section (LBld-05)
 * - Save deck for session (LBld-06)
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getSession,
  saveDeck,
  updateDeck,
} from "@/lib/limited/pool-storage";
import {
  validateLimitedDeck,
  canAddCardToDeck,
  isPoolCard,
  LIMITED_RULES,
  getCardCountInDeck,
} from "@/lib/limited/limited-validator";
import type {
  PoolCard,
  LimitedSession,
  LimitedDeckCard,
  PoolFilters,
} from "@/lib/limited/types";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Plus,
  Minus,
  Save,
  Trash2,
  Layers,
  AlertTriangle,
  Check,
  X,
  Lock,
} from "lucide-react";

// Color options for filtering
const COLOR_OPTIONS = [
  { value: "W", label: "White", className: "bg-white border" },
  { value: "U", label: "Blue", className: "bg-blue-500" },
  { value: "B", label: "Black", className: "bg-zinc-800" },
  { value: "R", label: "Red", className: "bg-red-500" },
  { value: "G", label: "Green", className: "bg-green-500" },
];

export default function LimitedDeckBuilderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // Get session ID from URL
  const sessionId = searchParams.get("session");

  // State
  const [session, setSession] = useState<LimitedSession | null>(null);
  const [pool, setPool] = useState<PoolCard[]>([]);
  const [deck, setDeck] = useState<LimitedDeckCard[]>([]);
  const [deckName, setDeckName] = useState("My Limited Deck");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLimitedMode, setIsLimitedMode] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter state
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  // Load session
  useEffect(() => {
    async function loadSession() {
      if (!sessionId) {
        setError("No session ID provided");
        setIsLoading(false);
        return;
      }

      try {
        const loadedSession = await getSession(sessionId);
        if (!loadedSession) {
          setError("Session not found");
          setIsLoading(false);
          return;
        }

        setSession(loadedSession);
        setPool(loadedSession.pool);
        setDeck(loadedSession.deck);
        if (loadedSession.name) {
          setDeckName(loadedSession.name);
        }
      } catch (err) {
        console.error("Failed to load session:", err);
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        setIsLoading(false);
      }
    }

    loadSession();
  }, [sessionId]);

  // Filter pool based on current filters
  const filteredPool = useMemo(() => {
    let filtered = pool;

    // Apply color filter
    if (selectedColors.length > 0) {
      filtered = filtered.filter((card) =>
        selectedColors.some((color) => card.colors.includes(color))
      );
    }

    // Apply type filter
    if (selectedTypes.length > 0) {
      filtered = filtered.filter((card) =>
        selectedTypes.some((type) =>
          card.type_line?.toLowerCase().includes(type.toLowerCase())
        )
      );
    }

    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (card) =>
          card.name.toLowerCase().includes(query) ||
          card.type_line?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [pool, selectedColors, selectedTypes, searchQuery]);

  // Group pool cards by name
  const groupedPool = useMemo(() => {
    const groups = new Map<string, PoolCard[]>();

    for (const card of filteredPool) {
      const existing = groups.get(card.name) || [];
      existing.push(card);
      groups.set(card.name, existing);
    }

    return Array.from(groups.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [filteredPool]);

  // Get deck stats
  const deckStats = useMemo(() => {
    const validation = validateLimitedDeck(deck);
    return {
      validation,
      totalCards: deck.reduce((sum, card) => sum + card.count, 0),
      uniqueCards: deck.length,
    };
  }, [deck]);

  // Add card to deck
  const addCardToDeck = (poolCard: PoolCard) => {
    if (!isPoolCard(poolCard.id, pool)) {
      toast({
        variant: "destructive",
        title: "Cannot Add Card",
        description: "This card is not in your pool.",
      });
      return;
    }

    if (!canAddCardToDeck(poolCard, deck)) {
      toast({
        variant: "destructive",
        title: "Card Limit Reached",
        description: `Maximum ${LIMITED_RULES.maxCopies} copies of "${poolCard.name}" allowed.`,
      });
      return;
    }

    setDeck((prevDeck) => {
      const existingIndex = prevDeck.findIndex(
        (d) => d.card.id === poolCard.id
      );

      if (existingIndex >= 0) {
        return prevDeck.map((d, i) =>
          i === existingIndex ? { ...d, count: d.count + 1 } : d
        );
      } else {
        return [
          ...prevDeck,
          {
            card: poolCard,
            count: 1,
            addedAt: new Date().toISOString(),
          },
        ];
      }
    });
  };

  // Remove card from deck
  const removeCardFromDeck = (cardId: string, count: number = 1) => {
    setDeck((prevDeck) => {
      return prevDeck
        .map((d) => {
          if (d.card.id === cardId) {
            return { ...d, count: d.count - count };
          }
          return d;
        })
        .filter((d) => d.count > 0);
    });
  };

  // Clear deck
  const clearDeck = () => {
    setDeck([]);
    toast({
      title: "Deck Cleared",
      description: "Your deck has been emptied.",
    });
  };

  // Save deck
  const handleSaveDeck = async () => {
    if (!session) return;

    setIsSaving(true);
    try {
      await saveDeck(session.id, deck);
      toast({
        title: "Deck Saved",
        description: "Your deck has been saved to the session.",
      });
    } catch (err) {
      console.error("Failed to save deck:", err);
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: err instanceof Error ? err.message : "Failed to save deck",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle color filter
  const toggleColor = (color: string) => {
    setSelectedColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]
    );
  };

  // Toggle type filter
  const toggleType = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type]
    );
  };

  // Clear filters
  const clearFilters = () => {
    setSelectedColors([]);
    setSelectedTypes([]);
    setSearchQuery("");
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full min-h-svh w-full flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading session...</p>
      </div>
    );
  }

  // Error state
  if (error || !session) {
    return (
      <div className="flex h-full min-h-svh w-full flex-col items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              {error || "Session not found"}
            </p>
            <Button onClick={() => router.push("/set-browser")}>
              Return to Set Browser
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-svh w-full flex-col">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 border-b">
        <div>
          <h1 className="font-headline text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6" />
            Limited Deck Builder
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Building from {session.setName} pool • {session.id.slice(0, 8)}...
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/sealed?session=${session.id}`)}
          >
            View Pool ({pool.length})
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clearDeck}
            disabled={deck.length === 0}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear
          </Button>
          <Button
            onClick={handleSaveDeck}
            disabled={isSaving || !deckStats.validation.isValid}
          >
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving..." : "Save Deck"}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Card Search */}
        <div className="w-full lg:w-1/2 flex flex-col border-r overflow-hidden">
          {/* Search and Filters */}
          <div className="p-4 border-b space-y-3">
            {/* Mode Toggle */}
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Limited Mode</span>
              <Badge variant="secondary" className="text-xs">
                Pool cards only
              </Badge>
            </div>

            {/* Search */}
            <Input
              placeholder="Search cards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={!isLimitedMode}
            />

            {/* Color Filters */}
            <div className="flex items-center gap-2">
              <Label className="text-sm">Colors:</Label>
              <div className="flex gap-1">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => toggleColor(color.value)}
                    disabled={!isLimitedMode}
                    className={cn(
                      "h-7 w-7 rounded-md border-2 transition-all disabled:opacity-50",
                      color.className,
                      selectedColors.includes(color.value)
                        ? "ring-2 ring-primary ring-offset-2"
                        : "opacity-60 hover:opacity-100"
                    )}
                    title={color.label}
                  />
                ))}
              </div>
            </div>

            {/* Type Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-sm">Types:</Label>
              {["creature", "instant", "sorcery", "enchantment", "artifact", "planeswalker", "land"].map(
                (type) => (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    disabled={!isLimitedMode}
                    className={cn(
                      "px-2 py-0.5 text-xs rounded-md border transition-all disabled:opacity-50 capitalize",
                      selectedTypes.includes(type)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-input hover:bg-accent"
                    )}
                  >
                    {type}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Card Grid */}
          <ScrollArea className="flex-1 p-4">
            <div className="mb-2 text-sm text-muted-foreground">
              {groupedPool.length} cards available
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {groupedPool.map(([name, cards]) => (
                <PoolCardButton
                  key={name}
                  card={cards[0]}
                  quantity={cards.length}
                  inDeck={getCardCountInDeck(cards[0].id, deck)}
                  onAdd={() => addCardToDeck(cards[0])}
                  disabled={!canAddCardToDeck(cards[0], deck)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel: Deck List */}
        <div className="hidden lg:flex lg:w-1/2 flex-col overflow-hidden">
          <ScrollArea className="flex-1 p-4">
            {/* Deck Name */}
            <div className="mb-4">
              <Input
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                className="text-xl font-bold"
                placeholder="Deck Name"
              />
            </div>

            {/* Validation Status */}
            <DeckValidationStatus
              validation={deckStats.validation}
              totalCards={deckStats.totalCards}
              requiredCards={LIMITED_RULES.minCards}
            />

            {/* Deck List */}
            <div className="space-y-1 mt-4">
              {deck.length === 0 ? (
                <p className="text-muted-foreground text-sm p-4 text-center">
                  No cards in deck yet. Click cards on the left to add them.
                </p>
              ) : (
                deck
                  .sort((a, b) => {
                    // Sort by type, then by name
                    const typeA = a.card.type_line || "";
                    const typeB = b.card.type_line || "";
                    if (typeA !== typeB) {
                      return typeA.localeCompare(typeB);
                    }
                    return a.card.name.localeCompare(b.card.name);
                  })
                  .map((deckCard) => (
                    <DeckCardRow
                      key={deckCard.card.id}
                      card={deckCard}
                      onAdd={() => addCardToDeck(deckCard.card)}
                      onRemove={() => removeCardFromDeck(deckCard.card.id)}
                      canAdd={canAddCardToDeck(deckCard.card, deck)}
                    />
                  ))
              )}
            </div>
          </ScrollArea>

          {/* Footer: Deck Stats */}
          <div className="p-4 border-t bg-muted/30">
            <div className="flex items-center justify-between text-sm">
              <span>
                {deckStats.totalCards} / {LIMITED_RULES.minCards} cards
              </span>
              <span>{deckStats.uniqueCards} unique cards</span>
            </div>

            {/* Play Button (Phase 17) */}
            <div className="mt-3 pt-3 border-t">
              <Button
                className="w-full"
                disabled
                variant="secondary"
              >
                Play Game — Coming in Phase 17
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface PoolCardButtonProps {
  card: PoolCard;
  quantity: number;
  inDeck: number;
  onAdd: () => void;
  disabled: boolean;
}

function PoolCardButton({
  card,
  quantity,
  inDeck,
  onAdd,
  disabled,
}: PoolCardButtonProps) {
  const imageUrl =
    card.image_uris?.normal ||
    card.image_uris?.large ||
    card.image_uris?.small;

  return (
    <button
      onClick={onAdd}
      disabled={disabled}
      className={cn(
        "relative group aspect-[2.5/3.5] rounded-md overflow-hidden border bg-muted transition-all",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={card.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center p-1">
          <span className="text-[10px] text-center font-medium leading-tight">
            {card.name}
          </span>
        </div>
      )}

      {/* Quantity and Deck Count */}
      <div className="absolute top-0 left-0 right-0 flex justify-between p-1">
        {quantity > 1 && (
          <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-xs">
            {quantity}
          </Badge>
        )}
        {inDeck > 0 && (
          <Badge variant="default" className="h-5 px-1 flex items-center justify-center text-xs">
            {inDeck}
          </Badge>
        )}
      </div>

      {/* Add indicator on hover */}
      <div className="absolute inset-0 bg-primary/80 opacity-0 group-hover:opacity-100 group-disabled:opacity-0 transition-opacity flex items-center justify-center">
        <Plus className="h-6 w-6 text-primary-foreground" />
      </div>
    </button>
  );
}

interface DeckCardRowProps {
  card: LimitedDeckCard;
  onAdd: () => void;
  onRemove: () => void;
  canAdd: boolean;
}

function DeckCardRow({ card, onAdd, onRemove, canAdd }: DeckCardRowProps) {
  const imageUrl = card.card.image_uris?.small;

  return (
    <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group">
      {/* Card Image Thumbnail */}
      <div className="w-10 h-14 rounded overflow-hidden bg-muted flex-shrink-0">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={card.card.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs">
            {card.card.name.slice(0, 2)}
          </div>
        )}
      </div>

      {/* Card Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{card.card.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {card.card.type_line}
        </p>
      </div>

      {/* Count */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onRemove}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-6 text-center font-bold">{card.count}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onAdd}
          disabled={!canAdd}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

interface DeckValidationStatusProps {
  validation: ReturnType<typeof validateLimitedDeck>;
  totalCards: number;
  requiredCards: number;
}

function DeckValidationStatus({
  validation,
  totalCards,
  requiredCards,
}: DeckValidationStatusProps) {
  const isComplete = totalCards >= requiredCards && validation.isValid;

  return (
    <div className="space-y-2">
      {/* Card Count Progress */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full transition-all",
              totalCards >= requiredCards ? "bg-green-500" : "bg-primary"
            )}
            style={{ width: `${Math.min(100, (totalCards / requiredCards) * 100)}%` }}
          />
        </div>
        <span
          className={cn(
            "text-sm font-medium",
            isComplete ? "text-green-500" : totalCards >= requiredCards - 5 ? "text-yellow-500" : ""
          )}
        >
          {totalCards}/{requiredCards}
        </span>
      </div>

      {/* Validation Messages */}
      {validation.errors.length > 0 && (
        <div className="space-y-1">
          {validation.errors.map((error, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-sm text-destructive"
            >
              <X className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ))}
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div className="space-y-1">
          {validation.warnings.map((warning, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-sm text-yellow-500"
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {isComplete && (
        <div className="flex items-center gap-2 text-sm text-green-500">
          <Check className="h-4 w-4" />
          <span>Deck is valid for limited play</span>
        </div>
      )}
    </div>
  );
}
