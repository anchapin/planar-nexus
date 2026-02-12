"use client";

import * as React from "react";
import { HandDisplay } from "./hand-display";
import { CardState } from "@/types/game";
import { ScryfallCard } from "@/app/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// Sample card data for demonstration
const sampleScryfallCards: ScryfallCard[] = [
  {
    id: "1",
    name: "Sol Ring",
    type_line: "Artifact",
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/a/6/a6c00e9c-2a72-4d4d-8c73-c5f6a8c0f4c5.jpg",
    },
    oracle_text: "{T}: Add {C}{C}.",
    legalities: {
      standard: "not_legal",
      pioneer: "not_legal",
      modern: "not_legal",
      legacy: "legal",
      vintage: "legal",
      commander: "legal",
    },
  },
  {
    id: "2",
    name: "Lightning Bolt",
    type_line: "Instant",
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/6/4/6457e3ea-1a15-4740-8cd3-1c0e28b5d9df.jpg",
    },
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    legalities: {
      standard: "not_legal",
      pioneer: "not_legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
      commander: "legal",
    },
  },
  {
    id: "3",
    name: "Counterspell",
    type_line: "Instant",
    mana_cost: "{U}{U}",
    cmc: 2,
    colors: ["U"],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/3/8/3877d79b-cb96-4553-a8a0-1c9f16b6d62e.jpg",
    },
    oracle_text: "Counter target spell.",
    legalities: {
      standard: "not_legal",
      pioneer: "not_legal",
      modern: "not_legal",
      legacy: "legal",
      vintage: "legal",
      commander: "legal",
    },
  },
  {
    id: "4",
    name: "Dark Ritual",
    type_line: "Instant",
    mana_cost: "{B}",
    cmc: 1,
    colors: ["B"],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/e/6/e6c8a3c4-7a88-4c5b-9f2d-1e9c7c5e6c8a.jpg",
    },
    oracle_text: "Add {B}{B}{B}.",
    legalities: {
      standard: "not_legal",
      pioneer: "not_legal",
      modern: "not_legal",
      legacy: "legal",
      vintage: "legal",
      commander: "legal",
    },
  },
  {
    id: "5",
    name: "Llanowar Elves",
    type_line: "Creature — Elf Druid",
    mana_cost: "{G}",
    cmc: 1,
    colors: ["G"],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/8/e/8e8f8a8a-1a15-4740-8cd3-1c0e28b5d9df.jpg",
    },
    oracle_text: "{T}: Add {G}.",
    power: "1",
    toughness: "1",
    legalities: {
      standard: "not_legal",
      pioneer: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
      commander: "legal",
    },
  },
  {
    id: "6",
    name: "Wrath of God",
    type_line: "Sorcery",
    mana_cost: "{2}{W}{W}",
    cmc: 4,
    colors: ["W"],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/f/5/f5c9f4e9-1a15-4740-8cd3-1c0e28b5d9df.jpg",
    },
    oracle_text: "Destroy all creatures. They can't be regenerated.",
    legalities: {
      standard: "not_legal",
      pioneer: "not_legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
      commander: "legal",
    },
  },
  {
    id: "7",
    name: "Giant Growth",
    type_line: "Instant",
    mana_cost: "{G}",
    cmc: 1,
    colors: ["G"],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/4/5/4577e3ea-1a15-4740-8cd3-1c0e28b5d9df.jpg",
    },
    oracle_text: "Target creature gets +3/+3 until end of turn.",
    legalities: {
      standard: "not_legal",
      pioneer: "not_legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
      commander: "legal",
    },
  },
  {
    id: "8",
    name: "Ancestral Recall",
    type_line: "Instant",
    mana_cost: "{U}",
    cmc: 1,
    colors: ["U"],
    image_uris: {
      normal: "https://cards.scryfall.io/normal/front/8/8/8877d79b-cb96-4553-a8a0-1c9f16b6d62e.jpg",
    },
    oracle_text: "Draw 3 cards.",
    legalities: {
      standard: "not_legal",
      pioneer: "not_legal",
      modern: "not_legal",
      legacy: "restricted",
      vintage: "restricted",
      commander: "banned",
    },
  },
];

// Create CardState objects from sample data
function createCardStates(scryfallCards: ScryfallCard[], playerId: string): CardState[] {
  return scryfallCards.map((card, index) => ({
    id: `${playerId}-card-${index}`,
    card,
    zone: "hand" as const,
    playerId,
    tapped: false,
    faceDown: false,
  }));
}

export function HandDisplayDemo() {
  const [selectedCardIds, setSelectedCardIds] = React.useState<string[]>([]);
  const [lastClickedCard, setLastClickedCard] = React.useState<string | null>(null);

  // Create sample hands
  const currentPlayerHand = React.useMemo(
    () => createCardStates(sampleScryfallCards.slice(0, 7), "player-1"),
    []
  );

  const opponentHand = React.useMemo(
    () => createCardStates(sampleScryfallCards.slice(0, 5), "player-2"),
    []
  );

  const largeHand = React.useMemo(
    () => createCardStates([...sampleScryfallCards, ...sampleScryfallCards].slice(0, 12), "player-3"),
    []
  );

  const handleCardSelect = (cardIds: string[]) => {
    setSelectedCardIds(cardIds);
  };

  const handleCardClick = (cardId: string) => {
    setLastClickedCard(cardId);
  };

  const handleCastSelected = () => {
    console.log("Casting cards:", selectedCardIds);
    alert(`Attempting to cast ${selectedCardIds.length} card(s):\n${selectedCardIds.join("\n")}`);
  };

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold">Hand Display Component Demo</h1>
        <p className="text-muted-foreground">
          Interactive demonstration of the hand display system for Planar Nexus
        </p>
      </div>

      <Tabs defaultValue="current-player" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="current-player">Current Player</TabsTrigger>
          <TabsTrigger value="opponent">Opponent</TabsTrigger>
          <TabsTrigger value="large-hand">Large Hand</TabsTrigger>
          <TabsTrigger value="api">API Reference</TabsTrigger>
        </TabsList>

        <TabsContent value="current-player" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Current Player's Hand</CardTitle>
              <CardDescription>
                Cards are displayed face-up with full selection capabilities
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <HandDisplay
                cards={currentPlayerHand}
                isCurrentPlayer={true}
                onCardSelect={handleCardSelect}
                onCardClick={handleCardClick}
                selectedCardIds={selectedCardIds}
                className="min-h-[200px]"
              />

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Selected: {selectedCardIds.length} card(s)
                  </div>
                  <Button
                    onClick={handleCastSelected}
                    disabled={selectedCardIds.length === 0}
                    size="sm"
                  >
                    Cast Selected
                  </Button>
                </div>

                {selectedCardIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedCardIds.map((id) => {
                      const card = currentPlayerHand.find((c) => c.id === id);
                      return card ? (
                        <Badge key={id} variant="secondary">
                          {card.card.name}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                )}

                {lastClickedCard && (
                  <div className="text-xs text-muted-foreground">
                    Last clicked: {lastClickedCard}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="opponent" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Opponent's Hand</CardTitle>
              <CardDescription>
                Card backs are shown for opponent hands (hidden information)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HandDisplay
                cards={opponentHand}
                isCurrentPlayer={false}
                onCardClick={handleCardClick}
                className="min-h-[200px]"
              />

              <Separator className="my-4" />

              <div className="text-sm text-muted-foreground">
                Opponent has {opponentHand.length} card(s) in hand
              </div>

              {lastClickedCard && (
                <div className="text-xs text-muted-foreground mt-2">
                  Last clicked card back: {lastClickedCard}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="large-hand" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Large Hand (12 cards)</CardTitle>
              <CardDescription>
                Demonstrates how the component handles larger hands with scrolling
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <HandDisplay
                cards={largeHand}
                isCurrentPlayer={true}
                onCardSelect={handleCardSelect}
                onCardClick={handleCardClick}
                selectedCardIds={selectedCardIds}
                className="min-h-[200px]"
              />

              <Separator />

              <div className="text-sm text-muted-foreground">
                Try sorting by different options and toggling between overlapping and spread modes
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Component API</CardTitle>
              <CardDescription>
                Props and usage information for the HandDisplay component
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">Props</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <code className="bg-muted px-2 py-1 rounded">cards: CardState[]</code>
                    <p className="text-muted-foreground mt-1">
                      Array of cards to display in the hand
                    </p>
                  </div>
                  <div>
                    <code className="bg-muted px-2 py-1 rounded">isCurrentPlayer: boolean</code>
                    <p className="text-muted-foreground mt-1">
                      Whether this is the current player's hand (shows face-up) or an opponent's (shows card backs)
                    </p>
                  </div>
                  <div>
                    <code className="bg-muted px-2 py-1 rounded">onCardSelect?: (cardIds: string[]) => void</code>
                    <p className="text-muted-foreground mt-1">
                      Callback when card selection changes (multi-select)
                    </p>
                  </div>
                  <div>
                    <code className="bg-muted px-2 py-1 rounded">onCardClick?: (cardId: string) => void</code>
                    <p className="text-muted-foreground mt-1">
                      Callback when a card is clicked
                    </p>
                  </div>
                  <div>
                    <code className="bg-muted px-2 py-1 rounded">selectedCardIds?: string[]</code>
                    <p className="text-muted-foreground mt-1">
                      Array of currently selected card IDs (for controlled selection)
                    </p>
                  </div>
                  <div>
                    <code className="bg-muted px-2 py-1 rounded">className?: string</code>
                    <p className="text-muted-foreground mt-1">
                      Additional CSS classes for the container
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <h3 className="font-semibold text-lg">Features</h3>
                <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
                  <li>Multi-select card selection for current player</li>
                  <li>Card back display for opponent hands</li>
                  <li>Sorting by name, mana cost, type, or color</li>
                  <li>Toggle between overlapping and spread display modes</li>
                  <li>Scrollable horizontal layout for large hands</li>
                  <li>Visual selection feedback with ring indicators</li>
                  <li>Tooltips showing card details</li>
                  <li>Mana cost and color indicator overlays</li>
                  <li>Card count display</li>
                  <li>Selection count badge</li>
                </ul>
              </div>

              <Separator />

              <div className="space-y-2">
                <h3 className="font-semibold text-lg">Usage Example</h3>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs">
{`import { HandDisplay } from "@/components/hand-display";

function MyGameComponent() {
  const [selectedCards, setSelectedCards] = useState<string[]>([]);

  return (
    <HandDisplay
      cards={playerHand}
      isCurrentPlayer={true}
      onCardSelect={setSelectedCards}
      onCardClick={(cardId) => console.log("Clicked:", cardId)}
      selectedCardIds={selectedCards}
    />
  );
}`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Implementation Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            This component is designed to integrate seamlessly with the existing game board.
            Replace the hand zone display in game-board.tsx with this component for a rich,
            interactive hand management experience.
          </p>
          <p>
            The component automatically handles different hand sizes and provides intuitive
            controls for sorting and display modes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
