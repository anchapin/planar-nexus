"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Swords, Info, Play } from "lucide-react";
import { DIFFICULTY_CONFIGS, DifficultyLevel } from "@/ai/ai-difficulty";

export default function SinglePlayerPage() {
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("medium");
  const [aiTheme, setAiTheme] = useState("aggressive red");
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const { toast } = useToast();

  const handleStartGame = (mode: "self-play" | "ai") => {
    const config = DIFFICULTY_CONFIGS[difficulty];
    
    // In a real implementation, you would:
    // 1. Load the selected deck
    // 2. Generate AI deck (for AI mode)
    // 3. Initialize game state
    // 4. Navigate to game board
    
    toast({
      title: "Starting Game",
      description: `Initializing ${mode === 'ai' ? `AI opponent (${config.displayName})` : 'self-play'} session...`,
    });
    
    // Navigate to game board with game config
    router.push(`/game-board?mode=${mode}&difficulty=${difficulty}&theme=${encodeURIComponent(aiTheme)}`);
  };

  return (
    <div className="flex-1 p-4 md:p-6">
      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">Single Player</h1>
        <p className="text-muted-foreground mt-1">
          Hone your skills and test your decks against AI or practice on your own.
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
                  Set up your AI opponent's deck theme and difficulty level.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="deck-select">Your Deck</Label>
                  <Select
                    value={selectedDeck || ""}
                    onValueChange={(value) => setSelectedDeck(value)}
                  >
                    <SelectTrigger id="deck-select">
                      <SelectValue placeholder="Select a deck" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter-aggro">Starter Aggro (Red Burn)</SelectItem>
                      <SelectItem value="starter-control">Starter Control (Blue Counters)</SelectItem>
                      <SelectItem value="starter-midrange">Starter Midrange (Green Creatures)</SelectItem>
                      <SelectItem value="custom">Custom Deck (from deck builder)</SelectItem>
                    </SelectContent>
                  </Select>
                  {!selectedDeck && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Select a deck to continue
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
                    onValueChange={(value) => setDifficulty(value as DifficultyLevel)}
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
                        <p className="text-sm font-medium">{DIFFICULTY_CONFIGS[difficulty].displayName}</p>
                        <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                          Target Win Rate: {difficulty === 'easy' ? '80%' : difficulty === 'medium' ? '60%' : difficulty === 'hard' ? '40%' : '25%'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {DIFFICULTY_CONFIGS[difficulty].description}
                      </p>
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        <div className="text-[10px] bg-background px-2 py-1 rounded">
                          <span className="font-medium">Lookahead:</span> {DIFFICULTY_CONFIGS[difficulty].lookaheadDepth} ply
                        </div>
                        <div className="text-[10px] bg-background px-2 py-1 rounded">
                          <span className="font-medium">Randomness:</span> {(DIFFICULTY_CONFIGS[difficulty].randomnessFactor * 100).toFixed(0)}%
                        </div>
                        <div className="text-[10px] bg-background px-2 py-1 rounded">
                          <span className="font-medium">Blunder Rate:</span> {(DIFFICULTY_CONFIGS[difficulty].blunderChance * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        {difficulty === 'easy' && "AI prioritizes survival but ignores card advantage and tempo. Makes frequent mistakes."}
                        {difficulty === 'medium' && "AI has balanced evaluation. Understands basics but can be outsmarted with advanced strategy."}
                        {difficulty === 'hard' && "AI values card advantage and tempo. Makes few mistakes and punishes errors."}
                        {difficulty === 'expert' && "AI plays near-optimally with deep lookahead. Maximizes all strategic advantages."}
                      </div>
                    </div>
                  </div>
                </div>
                
                <Button 
                  className="w-full" 
                  onClick={() => handleStartGame('ai')}
                  disabled={!selectedDeck}
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
                  Start a game where you control all actions. Perfect for testing combos and practicing your opening hands.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="self-play-deck">Your Deck</Label>
                  <Select
                    value={selectedDeck || ""}
                    onValueChange={(value) => setSelectedDeck(value)}
                  >
                    <SelectTrigger id="self-play-deck">
                      <SelectValue placeholder="Select a deck" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter-aggro">Starter Aggro (Red Burn)</SelectItem>
                      <SelectItem value="starter-control">Starter Control (Blue Counters)</SelectItem>
                      <SelectItem value="starter-midrange">Starter Midrange (Green Creatures)</SelectItem>
                      <SelectItem value="custom">Custom Deck (from deck builder)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <p className="text-sm text-muted-foreground">
                  You'll be taken to a game board where you can play both sides, draw cards, and test your deck's performance.
                </p>
                
                <Button 
                  className="w-full" 
                  onClick={() => handleStartGame('self-play')}
                  disabled={!selectedDeck}
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
