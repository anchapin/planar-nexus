"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Swords, Info, Play, BookOpen, Sparkles } from "lucide-react";
import { DIFFICULTY_CONFIGS, DifficultyLevel } from "@/ai/ai-difficulty";
import { SavedDeck } from "@/app/actions";

interface StarterDeck {
  id: string;
  name: string;
  description: string;
  type: "starter";
}

const STARTER_DECKS: StarterDeck[] = [
  {
    id: "starter-aggro",
    name: "Starter Aggro",
    description: "Red Burn - fast and aggressive",
    type: "starter",
  },
  {
    id: "starter-control",
    name: "Starter Control",
    description: "Blue Counters - reactive and tactical",
    type: "starter",
  },
  {
    id: "starter-midrange",
    name: "Starter Midrange",
    description: "Green Creatures - balanced threats",
    type: "starter",
  },
  {
    id: "starter-test",
    name: "Starter Test",
    description: "Test deck for E2E scenarios",
    type: "starter",
  },
];

type DeckOption = StarterDeck | SavedDeck;

function isStarterDeck(deck: DeckOption): deck is StarterDeck {
  return "type" in deck && deck.type === "starter";
}

function isCustomDeck(deck: DeckOption): deck is SavedDeck {
  return !("type" in deck);
}

export default function SinglePlayerPage() {
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("medium");
  const [aiTheme, setAiTheme] = useState("aggressive red");
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const emptyDeckArray = useMemo(() => [] as SavedDeck[], []);
  const [savedDecks] = useLocalStorage<SavedDeck[]>(
    "saved-decks",
    emptyDeckArray,
  );
  const { toast } = useToast();

  const allDecks: DeckOption[] = [...STARTER_DECKS, ...(savedDecks || [])];

  const selectedDeck = allDecks.find((d) => d.id === selectedDeckId) || null;

  const handleStartGame = (mode: "self-play" | "ai") => {
    if (!selectedDeck) {
      toast({
        title: "Select a deck",
        description: "Please choose a deck before starting the game.",
        variant: "destructive",
      });
      return;
    }

    const config = DIFFICULTY_CONFIGS[difficulty];
    const newGameId = `GAME-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Build navigation URL with deck info
    const params = new URLSearchParams();
    params.set("id", newGameId);
    params.set("mode", mode);
    params.set("difficulty", difficulty);
    params.set("theme", aiTheme);
    params.set("deckId", selectedDeck.id);

    toast({
      title: "Starting Game",
      description: `Initializing ${mode === "ai" ? `AI opponent (${config.displayName})` : "self-play"} session...`,
    });

    // If using a custom deck, pass it via sessionStorage so the game page
    // can load it immediately without waiting for async storage
    if (selectedDeck && isCustomDeck(selectedDeck)) {
      try {
        sessionStorage.setItem(
          "planar_nexus_selected_deck",
          JSON.stringify(selectedDeck),
        );
      } catch (e) {
        // Ignore sessionStorage errors
      }
    }

    router.push(`/game/${newGameId}?${params.toString()}`);
  };

  const getDeckLabel = (deck: DeckOption) => {
    if (isStarterDeck(deck)) {
      return (
        <div className="flex items-center gap-2">
          <span>{deck.name}</span>
          <Badge variant="secondary" className="text-[10px]">
            Starter
          </Badge>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between w-full gap-2">
        <span className="truncate">{deck.name}</span>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="outline" className="text-[10px] capitalize">
            {deck.format}
          </Badge>
          {deck.cards.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {deck.cards.reduce((sum, c) => sum + c.count, 0)} cards
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 p-4 md:p-6">
      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">Single Player</h1>
        <p className="text-muted-foreground mt-1">
          Hone your skills and test your decks against AI or practice on your
          own.
        </p>
      </header>
      <main className="flex justify-center">
        <Tabs defaultValue="play-ai" className="w-full max-w-2xl">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="play-ai">Play against AI</TabsTrigger>
            <TabsTrigger value="self-play">Self Play</TabsTrigger>
          </TabsList>

          <TabsContent value="play-ai">
            <Card>
              <CardHeader>
                <CardTitle>Configure AI Opponent</CardTitle>
                <CardDescription>
                  Set up your AI opponent&apos;s deck theme and difficulty
                  level.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="deck-select">Your Deck</Label>
                  <Select
                    value={selectedDeckId || ""}
                    onValueChange={(value) => setSelectedDeckId(value)}
                  >
                    <SelectTrigger id="deck-select">
                      <SelectValue placeholder="Select a deck" />
                    </SelectTrigger>
                    <SelectContent>
                      {allDecks.length === 0 ? (
                        <SelectItem value="no-decks" disabled>
                          No decks available
                        </SelectItem>
                      ) : (
                        allDecks.map((deck) => (
                          <SelectItem
                            key={deck.id}
                            value={deck.id}
                            data-testid={`deck-option-${deck.id}`}
                          >
                            {getDeckLabel(deck)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {!selectedDeckId && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Select a deck to continue
                    </p>
                  )}
                  {selectedDeck && isCustomDeck(selectedDeck) && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      Using custom deck: {selectedDeck.name} (
                      {selectedDeck.cards.reduce((s, c) => s + c.count, 0)}{" "}
                      cards)
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-theme">AI Deck Theme</Label>
                  <Input
                    id="ai-theme"
                    placeholder="e.g., 'token generation', 'mill', 'aggro'"
                    value={aiTheme}
                    onChange={(e) => setAiTheme(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The AI will generate a deck based on this theme
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="difficulty">Difficulty</Label>
                  <Select
                    value={difficulty}
                    onValueChange={(value) =>
                      setDifficulty(value as DifficultyLevel)
                    }
                  >
                    <SelectTrigger id="difficulty">
                      <SelectValue placeholder="Select difficulty" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(DIFFICULTY_CONFIGS).map((config) => (
                        <SelectItem key={config.level} value={config.level}>
                          {config.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="bg-muted p-3 rounded-md flex items-start gap-3 mt-2">
                    <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">
                          {DIFFICULTY_CONFIGS[difficulty].displayName}
                        </p>
                        <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                          Target Win Rate:{" "}
                          {difficulty === "easy"
                            ? "80%"
                            : difficulty === "medium"
                              ? "60%"
                              : difficulty === "hard"
                                ? "40%"
                                : "25%"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {DIFFICULTY_CONFIGS[difficulty].description}
                      </p>
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        <div className="text-[10px] bg-background px-2 py-1 rounded">
                          <span className="font-medium">Lookahead:</span>{" "}
                          {DIFFICULTY_CONFIGS[difficulty].lookaheadDepth} ply
                        </div>
                        <div className="text-[10px] bg-background px-2 py-1 rounded">
                          <span className="font-medium">Randomness:</span>{" "}
                          {(
                            DIFFICULTY_CONFIGS[difficulty].randomnessFactor *
                            100
                          ).toFixed(0)}
                          %
                        </div>
                        <div className="text-[10px] bg-background px-2 py-1 rounded">
                          <span className="font-medium">Blunder Rate:</span>{" "}
                          {(
                            DIFFICULTY_CONFIGS[difficulty].blunderChance * 100
                          ).toFixed(0)}
                          %
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        {difficulty === "easy" &&
                          "AI prioritizes survival but ignores card advantage and tempo. Makes frequent mistakes."}
                        {difficulty === "medium" &&
                          "AI has balanced evaluation. Understands basics but can be outsmarted with advanced strategy."}
                        {difficulty === "hard" &&
                          "AI values card advantage and tempo. Makes few mistakes and punishes errors."}
                        {difficulty === "expert" &&
                          "AI plays near-optimally with deep lookahead. Maximizes all strategic advantages."}
                      </div>
                    </div>
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={() => handleStartGame("ai")}
                  disabled={!selectedDeckId}
                >
                  <Swords className="mr-2 h-4 w-4" />
                  Start Game vs AI
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="self-play">
            <Card>
              <CardHeader>
                <CardTitle>Self Play (Goldfish)</CardTitle>
                <CardDescription>
                  Start a game where you control all actions. Perfect for
                  testing combos and practicing your opening hands.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="self-play-deck">Your Deck</Label>
                  <Select
                    value={selectedDeckId || ""}
                    onValueChange={(value) => setSelectedDeckId(value)}
                  >
                    <SelectTrigger id="self-play-deck">
                      <SelectValue placeholder="Select a deck" />
                    </SelectTrigger>
                    <SelectContent>
                      {allDecks.length === 0 ? (
                        <SelectItem value="no-decks" disabled>
                          No decks available
                        </SelectItem>
                      ) : (
                        allDecks.map((deck) => (
                          <SelectItem
                            key={deck.id}
                            value={deck.id}
                            data-testid={`deck-option-${deck.id}`}
                          >
                            {getDeckLabel(deck)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {selectedDeck && isCustomDeck(selectedDeck) && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      Using custom deck: {selectedDeck.name} (
                      {selectedDeck.cards.reduce((s, c) => s + c.count, 0)}{" "}
                      cards)
                    </p>
                  )}
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                  <p className="text-sm text-amber-800 flex items-start gap-2">
                    <BookOpen className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      In Self Play mode, you control both sides. This is great
                      for testing how your deck performs, practicing combos, or
                      learning the game interface.
                    </span>
                  </p>
                </div>

                <p className="text-sm text-muted-foreground">
                  You&apos;ll be taken to a game board where you can play both
                  sides, draw cards, and test your deck&apos;s performance.
                </p>

                <Button
                  className="w-full"
                  onClick={() => handleStartGame("self-play")}
                  disabled={!selectedDeckId}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Start Self Play Session
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
