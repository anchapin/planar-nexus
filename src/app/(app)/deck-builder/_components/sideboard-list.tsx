"use client";

import * as React from "react";
import { useMemo, memo } from "react";
import { DeckCard } from "@/app/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface SideboardListProps {
  /** Current sideboard card pool. Items are DeckCard entries (each with count). */
  sideboard: DeckCard[];
  /** Maximum allowed cards in the sideboard, e.g. 15 for constructed formats. */
  maxSize: number;
  /** Decrement one copy of a card. Idempotent for the last copy (removes the row). */
  onRemoveCard: (cardId: string) => void;
  /** Increment one copy of a card. The host is responsible for enforcing caps. */
  onAddCard: (card: DeckCard) => void;
}

interface SideboardRowProps {
  card: DeckCard;
  atCap: boolean;
  onRemoveCard: (cardId: string) => void;
  onAddCard: (card: DeckCard) => void;
}

/**
 * A single sideboard row (name + quantity stepper). The + button is
 * disabled when the sideboard is at its cap; the - button mirrors the
 * mainboard deck-list stepper behaviour (decrement-or-remove).
 *
 * Extracted and memoized to match the DeckList row pattern.
 */
const SideboardCardRow = memo(function SideboardCardRow({
  card,
  atCap,
  onRemoveCard,
  onAddCard,
}: SideboardRowProps) {
  return (
    <div
      className="group flex items-center justify-between text-sm p-1 rounded-md hover:bg-secondary border-l-2 border-l-transparent"
      data-testid={`sideboard-item-${card.name.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span>
        {card.count}x {card.name}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Decrease quantity of ${card.name}`}
          onClick={() => onRemoveCard(card.id)}
          data-testid={`sideboard-decrease-quantity-${card.id}`}
        >
          <Minus className="size-4" />
        </Button>
        <span
          className="w-5 text-center tabular-nums"
          aria-label={`Quantity ${card.count}`}
        >
          {card.count}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Increase quantity of ${card.name}`}
          onClick={() => onAddCard(card)}
          disabled={atCap}
          data-testid={`sideboard-increase-quantity-${card.id}`}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
});

/**
 * Sideboard editor for constructed (non-Commander) formats. Mirrors the
 * DeckList row UI but is intentionally flat (no categories, no commander
 * colour-identity badges, no virtualization) because the pool is bounded to
 * 15 cards by the format rules. Renders a live counter `x / maxSize` and
 * surfaces the cap as a disabled + button plus an at-cap badge. See #1402.
 */
export function SideboardList({
  sideboard,
  maxSize,
  onRemoveCard,
  onAddCard,
}: SideboardListProps) {
  const totalCards = useMemo(
    () => sideboard.reduce((sum, card) => sum + card.count, 0),
    [sideboard],
  );
  const atCap = totalCards >= maxSize;

  const sorted = useMemo(
    () =>
      [...sideboard].sort((a, b) => a.name.localeCompare(b.name)),
    [sideboard],
  );

  return (
    <Card
      className="flex flex-col h-full"
      data-testid="sideboard-list"
      data-sideboard-size={sideboard.length}
      data-sideboard-total={totalCards}
    >
      <CardHeader>
        <CardDescription className="flex items-center justify-between">
          <span data-testid="sideboard-count">
            {totalCards} / {maxSize} cards
          </span>
          <Badge
            variant={atCap ? "destructive" : "outline"}
            className="text-[10px] px-1.5 py-0"
            data-testid={atCap ? "sideboard-at-cap-badge" : "sideboard-cap-badge"}
          >
            {atCap ? "Full" : `${maxSize - totalCards} slots`}
          </Badge>
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="p-0 flex-grow">
        {sideboard.length === 0 ? (
          <div
            className="text-center text-muted-foreground py-10"
            data-testid="sideboard-empty"
          >
            Your sideboard is empty. Use the card search to add up to{" "}
            {maxSize} cards.
          </div>
        ) : (
          <div
            className="p-4 space-y-1"
            role="list"
            aria-label="Sideboard cards"
            data-testid="sideboard-items"
          >
            {sorted.map((card) => (
              <div key={card.id} role="listitem">
                <SideboardCardRow
                  card={card}
                  atCap={atCap}
                  onRemoveCard={onRemoveCard}
                  onAddCard={onAddCard}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
