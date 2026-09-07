"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { MagicFormat, ArchetypeCategory } from "@/lib/meta";
import {
  getMatchupGuide,
  getMatchupGuideCoverage,
  getMatchupGuideStatus,
  MatchupGuide,
} from "@/lib/matchup-guides";
import { MatchupSelector } from "@/components/meta/matchup/MatchupSelector";
import { MatchupGuideCard } from "@/components/meta/MatchupGuideCard";
import { MulliganTipsComponent } from "@/components/meta/MulliganTips";

const ARCHETYPE_LABEL: Record<ArchetypeCategory, string> = {
  aggro: "Aggro",
  control: "Control",
  midrange: "Midrange",
  combo: "Combo",
  tempo: "Tempo",
};

const FORMAT_LABEL: Record<MagicFormat, string> = {
  standard: "Standard",
  modern: "Modern",
  commander: "Commander",
};

export default function MatchupPage() {
  const [format, setFormat] = useState<MagicFormat>("standard");
  const [playerArchetype, setPlayerArchetype] = useState<
    ArchetypeCategory | ""
  >("");
  const [opponentArchetype, setOpponentArchetype] = useState<
    ArchetypeCategory | ""
  >("");
  const [guide, setGuide] = useState<MatchupGuide | null>(null);

  // Coverage report for the currently selected format. Recomputed only when the
  // format toggle changes — independent of which pair the user has selected.
  const coverage = useMemo(() => getMatchupGuideCoverage(format), [format]);

  // Status of the currently selected pair (if any). Used to distinguish
  // "no guide yet" from the initial "nothing selected yet" empty state.
  const selectedPairStatus: "covered" | "missing" | "none" =
    playerArchetype && opponentArchetype
      ? getMatchupGuideStatus(playerArchetype, opponentArchetype, format)
      : "none";

  const handleGetGuide = () => {
    if (playerArchetype && opponentArchetype) {
      const matchupGuide = getMatchupGuide(
        playerArchetype,
        opponentArchetype,
        format,
      );
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

      {/* Coverage Gaps — surfaces the top-N (here: full list, sorted) missing
          (playerArchetype, opponentArchetype) pairs for the active format so
          contributors can see what's still to be authored (META-03). */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="font-headline text-lg">
              Guide Coverage — {FORMAT_LABEL[format]}
            </CardTitle>
            <Badge
              variant={coverage.missing.length === 0 ? "default" : "secondary"}
              aria-label={`${coverage.covered} of ${coverage.total} matchups covered`}
            >
              {coverage.covered} / {coverage.total} covered
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {coverage.missing.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All {coverage.total} possible pairings have a guide — thank the
              contributors!
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No guide yet for these pairings — contribution welcome:
              </p>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {coverage.missing.map(
                  ({ playerArchetype: p, opponentArchetype: o }) => (
                    <li
                      key={`${p}-vs-${o}`}
                      className="flex items-center justify-between rounded border border-dashed border-muted-foreground/30 px-3 py-2 text-sm"
                    >
                      <span>
                        {ARCHETYPE_LABEL[p]} vs {ARCHETYPE_LABEL[o]}
                      </span>
                      <Badge variant="outline">missing</Badge>
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

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
                          <span className="text-primary font-medium">
                            {i + 1}.
                          </span>
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
                          <span className="text-primary font-medium">
                            {i + 1}.
                          </span>
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
                          <span className="text-primary font-medium">
                            {i + 1}.
                          </span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Separator />

                  {/* General Strategy */}
                  <div>
                    <h3 className="font-medium text-lg mb-3">
                      General Strategy
                    </h3>
                    <p className="text-muted-foreground">
                      {guide.gamePlan.generalStrategy}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      ) : selectedPairStatus === "missing" ? (
        <Card
          className="p-8 text-center"
          data-testid="matchup-missing-empty-state"
        >
          <CardContent className="space-y-2">
            <p className="text-base font-medium">
              No guide yet for{" "}
              {ARCHETYPE_LABEL[playerArchetype as ArchetypeCategory]} vs{" "}
              {ARCHETYPE_LABEL[opponentArchetype as ArchetypeCategory]} in{" "}
              {FORMAT_LABEL[format]} — contribution welcome.
            </p>
            <p className="text-sm text-muted-foreground">
              See the &quot;Guide Coverage&quot; panel above for the full list
              of pairings still to be authored.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <CardContent>
            <p className="text-muted-foreground">
              Select your deck archetype and opponent archetype above to get a
              matchup guide.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
