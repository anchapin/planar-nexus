"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Swords, Info } from "lucide-react";
import { DIFFICULTY_CONFIGS, DifficultyLevel } from "@/ai/ai-difficulty";

export default function SinglePlayerPage() {
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("medium");
  const [aiTheme, setAiTheme] = useState("aggressive red");
  const { toast } = useToast();

  const handleStartGame = (mode: "self-play" | "ai") => {
    const config = DIFFICULTY_CONFIGS[difficulty];
    toast({
      title: "Starting Game (Prototype)",
      description: `Game board would be initialized for ${mode === 'ai' ? `AI opponent (${config.displayName}, ${aiTheme})` : 'self-play'}.`,
    });
    // In a real app, you would navigate to a game board page:
    // router.push(\"/single-player/new-game?mode=\"
    // );
  };

  return (
    <div className="flex-1 p-4 md:p-6">
      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">Single Player</h1>
        <p className="text-muted-foreground mt-1">
          Hone your skills and test your decks.
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
                  <Label htmlFor="ai-theme">AI Deck Theme</Label>
                  <Input 
                    id="ai-theme" 
                    placeholder="e.g., 'token generation', 'mill'"
                    value={aiTheme}
                    onChange={(e) => setAiTheme(e.target.value)}
                  />
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
                    <div>
                      <p className="text-sm font-medium">{DIFFICULTY_CONFIGS[difficulty].displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {DIFFICULTY_CONFIGS[difficulty].description}
                      </p>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="text-[10px] bg-background px-2 py-1 rounded">
                          Lookahead: {DIFFICULTY_CONFIGS[difficulty].lookaheadDepth} levels
                        </div>
                        <div className="text-[10px] bg-background px-2 py-1 rounded">
                          Randomness: {(DIFFICULTY_CONFIGS[difficulty].randomnessFactor * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <Button className="w-full" onClick={() => handleStartGame('ai')}> 
                  <Swords className="mr-2 h-4 w-4" />
                  Battle the AI
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
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  You'll be taken to a game board with your selected deck, ready to play.
                </p>
                <Button className="w-full" onClick={() => handleStartGame('self-play')}> 
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
