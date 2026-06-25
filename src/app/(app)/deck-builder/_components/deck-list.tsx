"use client";

import { DeckCard } from "@/app/actions";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Minus, Plus, MinusCircle, AlertTriangle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useMemo, useState } from "react";
import {
  getCardColorIdentityStatus,
  getColorIdentityFixSuggestions,
  MANA_COLOR_NAMES,
  type ColorIdentityViolation,
} from "@/lib/game-rules";
import { cn } from "@/lib/utils";

interface DeckListProps {
  deck: DeckCard[];
  deckName: string;
  onDeckNameChange: (name: string) => void;
  onRemoveCard: (cardId: string) => void;
  onAddCard: (card: DeckCard) => void;
  /**
   * Color identity of the deck's commander. When provided, each card is
   * assessed against it and violations are highlighted. Omit to disable
   * color-identity checks entirely.
   */
  commanderColorIdentity?: string[];
}

type CategorizedDeck = {
  [key: string]: DeckCard[];
};

/**
 * Render a card's color identity as a compact badge (e.g. "RUG" or "C" for
 * colorless).
 */
function ColorIdentityBadge({ identity }: { identity: string[] }) {
  const label = identity.length > 0 ? identity.join("") : "C";
  return (
    <Badge
      variant="outline"
      className="ml-1.5 px-1.5 py-0 text-[10px] font-mono tracking-tight"
      data-testid="color-identity-badge"
      title={
        identity.length > 0
          ? identity.map((c) => MANA_COLOR_NAMES[c] || c).join(", ")
          : "Colorless"
      }
    >
      {label}
    </Badge>
  );
}

/**
 * Build a human-readable description of which colors a card violates.
 * e.g. "Has Blue but Commander is W/G only"
 */
function describeViolation(violation: ColorIdentityViolation, commanderIdentity: string[]): string {
  const violatedNames = violation.violatedColors
    .map((c) => MANA_COLOR_NAMES[c] || c)
    .join("/");
  const commanderLabel =
    commanderIdentity.length > 0 ? commanderIdentity.join("/") : "colorless";
  return `Has ${violatedNames} but Commander is ${commanderLabel} only`;
}

export function DeckList({
  deck,
  deckName,
  onDeckNameChange,
  onRemoveCard,
  onAddCard,
  commanderColorIdentity,
}: DeckListProps) {
  const totalCards = useMemo(() => deck.reduce((sum, card) => sum + card.count, 0), [deck]);
  const [fixMode, setFixMode] = useState(false);

  // Pre-compute a per-card color-identity status lookup keyed by card id.
  const statusById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getCardColorIdentityStatus>>();
    if (!commanderColorIdentity) return map;
    deck.forEach((card) => {
      map.set(card.id, getCardColorIdentityStatus(card, commanderColorIdentity));
    });
    return map;
  }, [deck, commanderColorIdentity]);

  // Cards to remove to satisfy the commander's color identity, sorted by
  // severity (violations first, then warnings), then alphabetically.
  const fixSuggestions = useMemo(
    () => getColorIdentityFixSuggestions(deck, commanderColorIdentity),
    [deck, commanderColorIdentity],
  );

  const hasViolations = fixSuggestions.length > 0;

  const categorizedDeck = useMemo(() => {
    return deck.reduce((acc, card) => {
      let type = "Other";
      if (card.type_line?.includes("Creature")) type = "Creatures";
      else if (card.type_line?.includes("Land")) type = "Lands";
      else if (card.type_line?.includes("Instant")) type = "Instants";
      else if (card.type_line?.includes("Sorcery")) type = "Sorceries";
      else if (card.type_line?.includes("Artifact")) type = "Artifacts";
      else if (card.type_line?.includes("Enchantment")) type = "Enchantments";
      else if (card.type_line?.includes("Planeswalker")) type = "Planeswalkers";

      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(card);
      return acc;
    }, {} as CategorizedDeck);
  }, [deck]);

  const categoryOrder = ["Creatures", "Instants", "Sorceries", "Artifacts", "Enchantments", "Planeswalkers", "Lands", "Other"];

  // Look up a card id for a suggestion name so the fix-mode remove button
  // can target the actual deck entry.
  const idByName = useMemo(() => {
    const map = new Map<string, string>();
    deck.forEach((card) => map.set(card.name, card.id));
    return map;
  }, [deck]);

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <Input
            className="text-lg font-headline font-bold border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
            value={deckName}
            onChange={(e) => onDeckNameChange(e.target.value)}
        />
        <CardDescription className="flex items-center justify-between">
          <span data-testid="deck-count">{totalCards} cards</span>
          {commanderColorIdentity && commanderColorIdentity.length > 0 && (
            <span className="text-xs">
              Commander:{" "}
              <span className="font-mono" data-testid="commander-color-identity">
                {commanderColorIdentity.join("")}
              </span>
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="p-0 flex-grow">
        <ScrollArea className="h-[calc(100vh-20rem)]">
          <div className="p-4 space-y-4">
            {deck.length === 0 ? (
                <div className="text-center text-muted-foreground py-10">
                    Your deck is empty.
                </div>
            ) : (
              <>
                {/* Color Identity Fix mode toggle */}
                {commanderColorIdentity && (
                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="color-fix-mode"
                        checked={fixMode}
                        onCheckedChange={setFixMode}
                        disabled={!hasViolations}
                        aria-label="Toggle color identity fix mode"
                        data-testid="color-fix-mode-switch"
                      />
                      <Label htmlFor="color-fix-mode" className="text-sm cursor-pointer">
                        Color Identity Fix
                      </Label>
                      {hasViolations ? (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0" data-testid="color-violation-count">
                          {fixSuggestions.length}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">No violations</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Color Identity Fix suggestions */}
                {fixMode && hasViolations && (
                  <div
                    className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2"
                    data-testid="color-fix-suggestions"
                  >
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                      <ShieldAlert className="size-4" />
                      Remove to comply
                    </div>
                    <ul className="space-y-1">
                      {fixSuggestions.map((suggestion) => {
                        const cardId = idByName.get(suggestion.name);
                        const isHardViolation = suggestion.severity === "violation";
                        return (
                          <li
                            key={suggestion.name}
                            className="flex items-center justify-between text-sm p-1 rounded-md hover:bg-secondary"
                            data-testid={`color-fix-item-${suggestion.name.toLowerCase().replace(/\s+/g, '-')}`}
                          >
                            <span className="flex items-center gap-1.5">
                              {isHardViolation ? (
                                <ShieldAlert className="size-3.5 text-destructive" />
                              ) : (
                                <AlertTriangle className="size-3.5 text-amber-500" />
                              )}
                              <span>{suggestion.name}</span>
                              <ColorIdentityBadge identity={suggestion.colorIdentity} />
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground hidden sm:inline">
                                {describeViolation(suggestion, commanderColorIdentity!)}
                              </span>
                              {cardId && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6"
                                  onClick={() => onRemoveCard(cardId)}
                                  aria-label={`Remove ${suggestion.name}`}
                                >
                                  <MinusCircle className="size-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {categoryOrder.map(category => {
                    if (categorizedDeck[category]) {
                        const categoryCount = categorizedDeck[category].reduce((sum: number, card: DeckCard) => sum + card.count, 0);
                        return (
                            <div key={category}>
                                <h4 className="font-semibold text-muted-foreground mb-2">{category} ({categoryCount})</h4>
                                <ul className="space-y-1">
                                    {categorizedDeck[category].sort((a: DeckCard, b: DeckCard) => a.name.localeCompare(b.name)).map(card => {
                                      const status = statusById.get(card.id);
                                      const isViolation = status?.severity === "violation";
                                      const isWarning = status?.severity === "warning";
                                      return (
                                        <li
                                          key={card.id}
                                          className={cn(
                                            "group flex items-center justify-between text-sm p-1 rounded-md hover:bg-secondary border-l-2",
                                            isViolation && "border-l-destructive bg-destructive/5",
                                            isWarning && "border-l-amber-500 bg-amber-500/5",
                                            !isViolation && !isWarning && "border-l-transparent",
                                          )}
                                          data-testid={`deck-item-${card.name.toLowerCase().replace(/\s+/g, '-')}`}
                                          title={
                                            status && status.severity !== "valid"
                                              ? describeViolation(
                                                  {
                                                    name: status.name,
                                                    colorIdentity: status.colorIdentity,
                                                    violatedColors: status.violatedColors,
                                                    severity: status.severity,
                                                  },
                                                  commanderColorIdentity!,
                                                )
                                              : undefined
                                          }
                                        >
                                            <span className="flex items-center">
                                                {card.count}x {card.name}
                                                {card.color_identity && card.color_identity.length > 0 && (
                                                  <ColorIdentityBadge identity={card.color_identity} />
                                                )}
                                                {isViolation && (
                                                  <ShieldAlert className="size-3.5 ml-1.5 text-destructive" data-testid="violation-icon" />
                                                )}
                                                {isWarning && (
                                                  <AlertTriangle className="size-3.5 ml-1.5 text-amber-500" data-testid="warning-icon" />
                                                )}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                <Button variant="ghost" size="icon" className="size-6" aria-label={`Decrease quantity of ${card.name}`} onClick={() => onRemoveCard(card.id)} data-testid={`decrease-quantity-${card.id}`}>
                                                    <Minus className="size-4" />
                                                </Button>
                                                <span className="w-5 text-center tabular-nums" aria-label={`Quantity ${card.count}`}>{card.count}</span>
                                                <Button variant="ghost" size="icon" className="size-6" aria-label={`Increase quantity of ${card.name}`} onClick={() => onAddCard(card)} data-testid={`increase-quantity-${card.id}`}>
                                                    <Plus className="size-4" />
                                                </Button>
                                            </div>
                                        </li>
                                      );
                                    })}
                                </ul>
                            </div>
                        )
                    }
                    return null;
                })}
              </>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
