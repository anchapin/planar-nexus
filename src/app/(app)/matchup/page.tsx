"use client";

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { MagicFormat, ArchetypeCategory } from '@/lib/meta';
import { getMatchupGuide, MatchupGuide } from '@/lib/matchup-guides';
import { MatchupSelector } from '@/components/meta/matchup/MatchupSelector';
import { MatchupGuideCard } from '@/components/meta/MatchupGuideCard';
import { MulliganTipsComponent } from '@/components/meta/MulliganTips';

export default function MatchupPage() {
  const [format, setFormat] = useState<MagicFormat>('standard');
  const [playerArchetype, setPlayerArchetype] = useState<ArchetypeCategory | "">("");
  const [opponentArchetype, setOpponentArchetype] = useState<ArchetypeCategory | "">("");
  const [guide, setGuide] = useState<MatchupGuide | null>(null);

  const handleGetGuide = () => {
    if (playerArchetype && opponentArchetype) {
      const matchupGuide = getMatchupGuide(playerArchetype, opponentArchetype, format);
      setGuide(matchupGuide);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Matchup Guides</h1>
        <p className="text-muted-foreground mt-2">
          Get strategic advice for specific deck matchups
        </p>
      </div>

      {/* Selector */}
      <MatchupSelector
        format={format}
        playerArchetype={playerArchetype}
        opponentArchetype={opponentArchetype}
        onFormatChange={setFormat}
        onPlayerArchetypeChange={setPlayerArchetype}
        onOpponentArchetypeChange={setOpponentArchetype}
        onGetGuide={handleGetGuide}
      />

      {/* Guide Display */}
      {guide ? (
        <div className="space-y-6">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="mulligan">Mulligan</TabsTrigger>
              <TabsTrigger value="strategy">Strategy</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4">
              <MatchupGuideCard guide={guide} />
            </TabsContent>

            {/* Mulligan Tab */}
            <TabsContent value="mulligan">
              <MulliganTipsComponent tips={guide.mulliganGuide} />
            </TabsContent>

            {/* Strategy Tab */}
            <TabsContent value="strategy">
              <Card>
                <CardHeader>
                  <CardTitle>Game Plan by Phase</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Opening */}
                  <div>
                    <h3 className="font-medium text-lg mb-3">Opening Phase</h3>
                    <ul className="space-y-2">
                      {guide.gamePlan.opening.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-primary font-medium">{i + 1}.</span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Separator />

                  {/* Mid-Game */}
                  <div>
                    <h3 className="font-medium text-lg mb-3">Mid-Game</h3>
                    <ul className="space-y-2">
                      {guide.gamePlan.midGame.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-primary font-medium">{i + 1}.</span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Separator />

                  {/* Late-Game */}
                  <div>
                    <h3 className="font-medium text-lg mb-3">Late-Game</h3>
                    <ul className="space-y-2">
                      {guide.gamePlan.lateGame.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-primary font-medium">{i + 1}.</span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Separator />

                  {/* General Strategy */}
                  <div>
                    <h3 className="font-medium text-lg mb-3">General Strategy</h3>
                    <p className="text-muted-foreground">
                      {guide.gamePlan.generalStrategy}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <Card className="p-8 text-center">
          <CardContent>
            <p className="text-muted-foreground">
              Select your deck archetype and opponent archetype above to get a matchup guide.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
