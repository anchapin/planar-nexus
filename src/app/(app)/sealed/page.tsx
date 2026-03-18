/**
 * Sealed Session Page
 *
 * Phase 14: Foundation
 * Requirements: SEAL-01, SEAL-02, SEAL-03, SEAL-04, SEAL-05
 *
 * Features:
 * - Create new sealed session from set code (?set={code})
 * - Load existing session (?session={id})
 * - Display sealed pool as card grid
 * - Filter pool by color, type, CMC
 * - Navigate to deck builder
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  getSession,
  createSession,
  filterPool,
} from "@/lib/limited/pool-storage";
import { generateSealedPool } from "@/lib/limited/sealed-generator";
import { getSetDetails } from "@/lib/limited/set-service";
import type { PoolCard, LimitedSession, PoolFilters } from "@/lib/limited/types";
import { Loader2, Package, Filter, Layers } from "lucide-react";

// Color options for filtering
const COLOR_OPTIONS = [
  { value: "W", label: "White", color: "bg-white border" },
  { value: "U", label: "Blue", color: "bg-blue-500" },
  { value: "B", label: "Black", color: "bg-zinc-800" },
  { value: "R", label: "Red", color: "bg-red-500" },
  { value: "G", label: "Green", color: "bg-green-500" },
];

// Type options for filtering
const TYPE_OPTIONS = [
  { value: "creature", label: "Creatures" },
  { value: "instant", label: "Instants" },
  { value: "sorcery", label: "Sorceries" },
  { value: "enchantment", label: "Enchantments" },
  { value: "artifact", label: "Artifacts" },
  { value: "planeswalker", label: "Planeswalkers" },
  { value: "land", label: "Lands" },
];

export default function SealedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State
  const [session, setSession] = useState<LimitedSession | null>(null);
  const [pool, setPool] = useState<PoolCard[]>([]);
  const [filteredPool, setFilteredPool] = useState<PoolCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setName, setSetName] = useState<string>("");

  // Filter state
  const [filters, setFilters] = useState<PoolFilters>({});
  const [showFilters, setShowFilters] = useState(true);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [cmcRange, setCmcRange] = useState<[number, number]>([0, 15]);

  // Get session ID or set code from URL
  const sessionId = searchParams.get("session");
  const setCode = searchParams.get("set");

  // Load or create session
  useEffect(() => {
    async function initSession() {
      setIsLoading(true);
      setError(null);

      try {
        if (sessionId) {
          // Load existing session
          const existingSession = await getSession(sessionId);
          if (!existingSession) {
            setError("Session not found");
            return;
          }
          setSession(existingSession);
          setPool(existingSession.pool);
          setSetName(existingSession.setName);
        } else if (setCode) {
          // Create new session
          setIsCreating(true);

          // Get set name
          let name = setCode.toUpperCase();
          try {
            const setDetails = await getSetDetails(setCode);
            if (setDetails) {
              name = setDetails.name;
              setSetName(name);
            }
          } catch {
            // Use set code as fallback
          }

          // Generate sealed pool
          const generatedPool = await generateSealedPool(setCode);

          // Create session
          const newSession = await createSession({
            setCode: setCode.toLowerCase(),
            setName: name,
            mode: "sealed",
          });

          // Update session with pool
          const sessionWithPool: LimitedSession = {
            ...newSession,
            pool: generatedPool,
          };

          setSession(sessionWithPool);
          setPool(generatedPool);

          // Redirect to session URL
          router.replace(`/sealed?session=${newSession.id}`);
        } else {
          setError("No session ID or set code provided");
        }
      } catch (err) {
        console.error("Failed to initialize session:", err);
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        setIsLoading(false);
        setIsCreating(false);
      }
    }

    initSession();
  }, [sessionId, setCode, router]);

  // Apply filters when pool or filter state changes
  useEffect(() => {
    const newFilters: PoolFilters = {};

    // Color filter
    if (selectedColors.length > 0) {
      newFilters.color = {
        mode: "include",
        colors: selectedColors,
      };
    }

    // Type filter
    if (selectedTypes.length > 0) {
      newFilters.type = {
        types: selectedTypes,
      };
    }

    // CMC filter
    if (cmcRange[0] > 0 || cmcRange[1] < 15) {
      newFilters.cmc = {
        mode: "range",
        min: cmcRange[0],
        max: cmcRange[1],
      };
    }

    setFilters(newFilters);

    // Apply filters
    const result = filterPool(pool, newFilters);
    setFilteredPool(result);
  }, [pool, selectedColors, selectedTypes, cmcRange]);

  // Group cards by name for display
  const groupedCards = useMemo(() => {
    const groups = new Map<string, PoolCard[]>();

    for (const card of filteredPool) {
      const existing = groups.get(card.name) || [];
      existing.push(card);
      groups.set(card.name, existing);
    }

    // Sort by name
    return Array.from(groups.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [filteredPool]);

  // Toggle color filter
  const toggleColor = (color: string) => {
    setSelectedColors((prev) =>
      prev.includes(color)
        ? prev.filter((c) => c !== color)
        : [...prev, color]
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

  // Clear all filters
  const clearFilters = () => {
    setSelectedColors([]);
    setSelectedTypes([]);
    setCmcRange([0, 15]);
  };

  // Navigate to deck builder
  const handleBuildDeck = () => {
    if (session) {
      router.push(`/limited-deck-builder?session=${session.id}`);
    }
  };

  // Loading state
  if (isLoading || isCreating) {
    return (
      <div className="flex h-full min-h-svh w-full flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">
          {isCreating ? "Opening packs..." : "Loading session..."}
        </p>
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
            <Package className="h-6 w-6" />
            Sealed: {setName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pool.length} cards in pool • {session.id.slice(0, 8)}...
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-2" />
            {showFilters ? "Hide" : "Show"} Filters
          </Button>
          <Button onClick={handleBuildDeck}>
            <Layers className="h-4 w-4 mr-2" />
            Build Deck ({pool.length} cards)
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      {showFilters && (
        <div className="p-4 border-b bg-muted/30">
          <div className="flex flex-wrap items-center gap-4">
            {/* Color Filters */}
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Colors:</Label>
              <div className="flex gap-1">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => toggleColor(color.value)}
                    className={`
                      h-8 w-8 rounded-md border-2 transition-all
                      ${color.color}
                      ${
                        selectedColors.includes(color.value)
                          ? "ring-2 ring-primary ring-offset-2"
                          : "opacity-60 hover:opacity-100"
                      }
                    `}
                    title={color.label}
                  >
                    <span className="sr-only">{color.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Type Filters */}
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Types:</Label>
              <div className="flex flex-wrap gap-1">
                {TYPE_OPTIONS.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => toggleType(type.value)}
                    className={`
                      px-2 py-1 text-xs rounded-md border transition-all
                      ${
                        selectedTypes.includes(type.value)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-input hover:bg-accent"
                      }
                    `}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* CMC Filter */}
            <div className="flex items-center gap-2 min-w-[200px]">
              <Label className="text-sm font-medium whitespace-nowrap">CMC:</Label>
              <Slider
                value={cmcRange}
                onValueChange={(value) => setCmcRange(value as [number, number])}
                min={0}
                max={15}
                step={1}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground w-16 text-center">
                {cmcRange[0]}-{cmcRange[1] === 15 ? "∞" : cmcRange[1]}
              </span>
            </div>

            {/* Clear Filters */}
            {(selectedColors.length > 0 ||
              selectedTypes.length > 0 ||
              cmcRange[0] > 0 ||
              cmcRange[1] < 15) && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Card Grid */}
        <div className="flex-1 overflow-auto p-4">
          <div className="mb-4 text-sm text-muted-foreground">
            Showing {filteredPool.length} of {pool.length} cards (
            {groupedCards.length} unique)
          </div>

          {groupedCards.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">
                No cards match your filters
              </p>
              <Button
                variant="link"
                onClick={clearFilters}
                className="mt-2"
              >
                Clear filters
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
              {groupedCards.map(([name, cards]) => (
                <PoolCardDisplay
                  key={name}
                  card={cards[0]}
                  quantity={cards.length}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Pool Card Display Component
// ============================================================================

interface PoolCardDisplayProps {
  card: PoolCard;
  quantity: number;
}

function PoolCardDisplay({ card, quantity }: PoolCardDisplayProps) {
  // Get card image URL
  const imageUrl =
    card.image_uris?.normal ||
    card.image_uris?.large ||
    card.image_uris?.small;

  return (
    <div className="relative group">
      <div className="aspect-[2.5/3.5] rounded-md overflow-hidden border bg-muted">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={card.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-2">
            <span className="text-xs text-center font-medium">{card.name}</span>
          </div>
        )}
      </div>

      {/* Quantity Badge */}
      {quantity > 1 && (
        <Badge
          variant="secondary"
          className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center font-bold"
        >
          {quantity}
        </Badge>
      )}

      {/* Card Name on Hover */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-[10px] text-white line-clamp-2 leading-tight">
          {card.name}
        </p>
        <p className="text-[9px] text-white/70">
          {card.type_line}
        </p>
      </div>
    </div>
  );
}
