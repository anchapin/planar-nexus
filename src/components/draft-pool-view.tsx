/**
 * Draft Pool View Component
 *
 * Shows all cards picked during draft.
 * DRFT-05: Pool always visible during drafting
 *
 * Phase 15: Draft Core
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Package, Layers, Trash2 } from "lucide-react";
import type { PoolCard } from "@/lib/limited/types";

// ============================================================================
// Types
// ============================================================================

export interface DraftPoolViewProps {
  /** All picked cards */
  pool: PoolCard[];
  /** Draft session ID for navigation */
  sessionId?: string;
  /** Called when user clicks to remove a card */
  onRemoveCard?: (cardId: string) => void;
  /** Optional className */
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MINIMUM_DECK_SIZE = 40;
const MAXIMUM_CARDS_SHOWN = 200; // Limit for performance

// ============================================================================
// Component
// ============================================================================

/**
 * DraftPoolView - Shows all cards picked during draft
 *
 * DRFT-05: Always visible during drafting
 * Shows card counts, progress toward minimum deck size
 */
export function DraftPoolView({
  pool,
  sessionId,
  onRemoveCard,
  className,
}: DraftPoolViewProps) {
  const router = useRouter();

  // Group cards by name for display
  const groupedPool = useMemo(() => {
    const groups = new Map<string, PoolCard[]>();

    // Limit processing for large pools
    const poolToProcess = pool.slice(0, MAXIMUM_CARDS_SHOWN);

    for (const card of poolToProcess) {
      const existing = groups.get(card.name) || [];
      existing.push(card);
      groups.set(card.name, existing);
    }

    // Sort by name
    return Array.from(groups.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [pool]);

  // Calculate stats
  const stats = useMemo(() => {
    const uniqueCards = groupedPool.length;
    const totalCards = pool.length;
    const progress = Math.min(100, (totalCards / MINIMUM_DECK_SIZE) * 100);
    const isDeckReady = totalCards >= MINIMUM_DECK_SIZE;

    // Count by color
    const colorCounts: Record<string, number> = {};
    for (const card of pool) {
      const color = card.colors.length > 0 ? card.colors.join(",") : "Colorless";
      colorCounts[color] = (colorCounts[color] || 0) + 1;
    }

    return { uniqueCards, totalCards, progress, isDeckReady, colorCounts };
  }, [pool, groupedPool]);

  // Navigate to deck builder
  const handleBuildDeck = () => {
    if (sessionId) {
      router.push(`/limited-deck-builder?session=${sessionId}`);
    }
  };

  return (
    <Card
      className={cn(
        "flex flex-col h-full border-l-4 border-l-primary",
        className
      )}
    >
      {/* Header */}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="h-5 w-5" />
            Draft Pool
          </CardTitle>
          <Badge variant="secondary">
            {stats.totalCards} cards
          </Badge>
        </div>

        {/* Progress toward deck */}
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className={cn(
              "font-medium",
              stats.isDeckReady && "text-green-500"
            )}>
              {stats.totalCards} / {MINIMUM_DECK_SIZE}
            </span>
          </div>
          <Progress
            value={stats.progress}
            className="h-2"
          />
        </div>
      </CardHeader>

      {/* Card List */}
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full px-4 pb-4">
          {groupedPool.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-1">
              {groupedPool.map(([name, cards]) => (
                <PoolCardRow
                  key={name}
                  card={cards[0]}
                  quantity={cards.length}
                  onRemove={
                    onRemoveCard
                      ? () => onRemoveCard(cards[0].id)
                      : undefined
                  }
                />
              ))}
            </div>
          )}

          {/* Show indicator if truncated */}
          {pool.length > MAXIMUM_CARDS_SHOWN && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Showing first {MAXIMUM_CARDS_SHOWN} cards...
            </p>
          )}
        </ScrollArea>
      </CardContent>

      {/* Footer */}
      <div className="p-4 border-t bg-muted/30">
        <Button
          onClick={handleBuildDeck}
          disabled={!sessionId || !stats.isDeckReady}
          className="w-full"
        >
          <Layers className="h-4 w-4 mr-2" />
          Build Deck
        </Button>
        {!stats.isDeckReady && sessionId && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Pick {MINIMUM_DECK_SIZE - stats.totalCards} more cards
          </p>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// Pool Card Row
// ============================================================================

interface PoolCardRowProps {
  card: PoolCard;
  quantity: number;
  onRemove?: () => void;
}

function PoolCardRow({ card, quantity, onRemove }: PoolCardRowProps) {
  // Get card image
  const imageUrl = card.image_uris?.small;

  return (
    <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group">
      {/* Card Thumbnail */}
      <div className="w-8 h-11 rounded overflow-hidden bg-muted flex-shrink-0">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={card.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[8px]">
            {card.name.slice(0, 3)}
          </div>
        )}
      </div>

      {/* Card Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{card.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {card.type_line}
        </p>
      </div>

      {/* Quantity */}
      {quantity > 1 && (
        <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center">
          {quantity}
        </Badge>
      )}

      {/* Remove Button */}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onRemove}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Package className="h-12 w-12 text-muted-foreground/50 mb-3" />
      <p className="text-sm text-muted-foreground">
        Pick cards to build your pool
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Click on cards in your packs to add them
      </p>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================
