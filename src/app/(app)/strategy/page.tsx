"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MagicFormat, ArchetypeCategory } from '@/lib/meta';
import { getGamePhaseStrategy, GamePhaseStrategy } from '@/lib/game-phase-strategy';

export default function StrategyPage() {
  const [format, setFormat] = useState<MagicFormat>('standard');
  const [archetype, setArchetype] = useState<ArchetypeCategory>('aggro');
  const [strategy, setStrategy] = useState<GamePhaseStrategy | null>(null);

  const handleStrategyChange = (value: ArchetypeCategory) => {
    setArchetype(value);
    const s = getGamePhaseStrategy(value, format);
    setStrategy(s);
  };

  const handleFormatChange = (value: MagicFormat) => {
    setFormat(value);
    const s = getGamePhaseStrategy(archetype, value);
    setStrategy(s);
  };

  // Initialize strategy on mount
  useEffect(() => {
    const s = getGamePhaseStrategy(archetype, format);
    setStrategy(s);
  }, []);

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case 'excellent': return 'bg-green-500';
      case 'good': return 'bg-yellow-500';
      case 'fair': return 'bg-orange-500';
      case 'poor': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Game Strategy</h1>
        <p className="text-muted-foreground mt-2">
          Learn how to play your deck at every stage of the game
        </p>
      </div>

      {/* Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Your Deck Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Format</label>
              <Select value={format} onValueChange={handleFormatChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="modern">Modern</SelectItem>
                  <SelectItem value="commander">Commander</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Deck Archetype</label>
              <Select value={archetype} onValueChange={handleStrategyChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select archetype" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aggro">Aggro</SelectItem>
                  <SelectItem value="control">Control</SelectItem>
                  <SelectItem value="midrange">Midrange</SelectItem>
                  <SelectItem value="combo">Combo</SelectItem>
                  <SelectItem value="tempo">Tempo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strategy Display */}
      {strategy ? (
        <Tabs defaultValue="opening" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="opening">Opening</TabsTrigger>
            <TabsTrigger value="midgame">Mid-Game</TabsTrigger>
            <TabsTrigger value="lategame">Late-Game</TabsTrigger>
            <TabsTrigger value="combat">Combat</TabsTrigger>
          </TabsList>

          {/* Opening Phase */}
          <TabsContent value="opening" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Opening Phase Strategy</CardTitle>
                <CardDescription>
                  Your first few turns set the tone for the whole game
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Priorities */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Priorities</h3>
                  <ul className="space-y-2">
                    {strategy.opening.priorities.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Badge variant="default">{i + 1}</Badge>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Separator />

                {/* Ideal Scenario */}
                <div>
                  <h3 className="font-medium text-lg mb-2">Ideal Scenario</h3>
                  <Card className="bg-muted/50">
                    <CardContent className="pt-4">
                      <p>{strategy.opening.idealScenario}</p>
                    </CardContent>
                  </Card>
                </div>

                <Separator />

                {/* Common Mistakes */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Common Mistakes</h3>
                  <ul className="space-y-2">
                    {strategy.opening.commonMistakes.map((m, i) => (
                      <li key={i} className="flex items-start gap-2 text-red-500">
                        <span>✗</span>
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Separator />

                {/* Red Flags */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Red Flags</h3>
                  <ul className="space-y-2">
                    {strategy.opening.redFlags.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-orange-500">
                        <span>⚠</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Mid-Game */}
          <TabsContent value="midgame" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Mid-Game Strategy</CardTitle>
                <CardDescription>
                  The heart of the game where games are won or lost
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Priorities */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Priorities</h3>
                  <ul className="space-y-2">
                    {strategy.midGame.priorities.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Badge variant="default">{i + 1}</Badge>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Separator />

                {/* Ideal Scenario */}
                <div>
                  <h3 className="font-medium text-lg mb-2">Ideal Scenario</h3>
                  <Card className="bg-muted/50">
                    <CardContent className="pt-4">
                      <p>{strategy.midGame.idealScenario}</p>
                    </CardContent>
                  </Card>
                </div>

                <Separator />

                {/* Common Mistakes */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Common Mistakes</h3>
                  <ul className="space-y-2">
                    {strategy.midGame.commonMistakes.map((m, i) => (
                      <li key={i} className="flex items-start gap-2 text-red-500">
                        <span>✗</span>
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Separator />

                {/* Red Flags */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Red Flags</h3>
                  <ul className="space-y-2">
                    {strategy.midGame.redFlags.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-orange-500">
                        <span>⚠</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Late-Game */}
          <TabsContent value="lategame" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Late-Game Strategy</CardTitle>
                <CardDescription>
                  Topdeck wars and closing out games
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Priorities */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Priorities</h3>
                  <ul className="space-y-2">
                    {strategy.lateGame.priorities.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Badge variant="default">{i + 1}</Badge>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Separator />

                {/* Ideal Scenario */}
                <div>
                  <h3 className="font-medium text-lg mb-2">Ideal Scenario</h3>
                  <Card className="bg-muted/50">
                    <CardContent className="pt-4">
                      <p>{strategy.lateGame.idealScenario}</p>
                    </CardContent>
                  </Card>
                </div>

                <Separator />

                {/* Common Mistakes */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Common Mistakes</h3>
                  <ul className="space-y-2">
                    {strategy.lateGame.commonMistakes.map((m, i) => (
                      <li key={i} className="flex items-start gap-2 text-red-500">
                        <span>✗</span>
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Separator />

                {/* Red Flags */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Red Flags</h3>
                  <ul className="space-y-2">
                    {strategy.lateGame.redFlags.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-orange-500">
                        <span>⚠</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Combat */}
          <TabsContent value="combat" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Combat Strategy</CardTitle>
                <CardDescription>
                  Making the right decisions in combat
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Attacking */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Attacking</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base text-green-600">When To Attack</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1">
                          {strategy.combat.attacking.whenTo.map((w, i) => (
                            <li key={i} className="text-sm">✓ {w}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base text-red-600">When Not To Attack</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1">
                          {strategy.combat.attacking.whenNotTo.map((w, i) => (
                            <li key={i} className="text-sm">✗ {w}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <Separator />

                {/* Defending */}
                <div>
                  <h3 className="font-medium text-lg mb-3">Defending</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base text-green-600">When To Block</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1">
                          {strategy.combat.defending.whenTo.map((w, i) => (
                            <li key={i} className="text-sm">✓ {w}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base text-red-600">When Not To Block</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1">
                          {strategy.combat.defending.whenNotTo.map((w, i) => (
                            <li key={i} className="text-sm">✗ {w}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <Separator />

                {/* General Combat Tips */}
                <div>
                  <h3 className="font-medium text-lg mb-3">General Combat Tips</h3>
                  <ul className="space-y-2">
                    {strategy.combat.general.map((g, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Badge variant="outline">💡</Badge>
                        <span>{g}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        <Card className="p-8 text-center">
          <CardContent>
            <p className="text-muted-foreground">
              Select a deck archetype above to see strategy tips.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
