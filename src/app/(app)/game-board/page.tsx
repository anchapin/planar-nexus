"use client";

import * as React from "react";
import { GameBoard } from "@/components/game-board";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { PlayerState, PlayerCount, ZoneType } from "@/types/game";
import { Swords, Settings, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Mock data generator for demonstration
function generateMockPlayer(
  id: string,
  name: string,
  lifeTotal: number,
  isCommander: boolean
): PlayerState {
  const battlefieldCount = Math.floor(Math.random() * 8);
  const handCount = Math.floor(Math.random() * 7) + 1;
  const graveyardCount = Math.floor(Math.random() * 15);
  const exileCount = Math.floor(Math.random() * 5);
  const libraryCount = isCommander ? 99 - 7 - 10 : 60 - 7 - 10;

  return {
    id,
    name,
    lifeTotal,
    poisonCounters: 0,
    hand: Array.from({ length: handCount }, (_, i) => ({
      id: `${id}-hand-${i}`,
      card: {
        id: `card-${i}`,
        name: `Card ${i + 1}`,
        color_identity: [],
      },
      zone: "hand" as ZoneType,
      playerId: id,
    })),
    battlefield: Array.from({ length: battlefieldCount }, (_, i) => ({
      id: `${id}-battlefield-${i}`,
      card: {
        id: `card-${i}`,
        name: `Creature ${i + 1}`,
        color_identity: [],
      },
      zone: "battlefield" as ZoneType,
      playerId: id,
      tapped: Math.random() > 0.7,
    })),
    graveyard: Array.from({ length: graveyardCount }, (_, i) => ({
      id: `${id}-graveyard-${i}`,
      card: {
        id: `card-${i}`,
        name: `Card ${i + 1}`,
        color_identity: [],
      },
      zone: "graveyard" as ZoneType,
      playerId: id,
    })),
    exile: Array.from({ length: exileCount }, (_, i) => ({
      id: `${id}-exile-${i}`,
      card: {
        id: `card-${i}`,
        name: `Card ${i + 1}`,
        color_identity: [],
      },
      zone: "exile" as ZoneType,
      playerId: id,
    })),
    library: Array.from({ length: libraryCount }, (_, i) => ({
      id: `${id}-library-${i}`,
      card: {
        id: `card-${i}`,
        name: `Card ${i + 1}`,
        color_identity: [],
      },
      zone: "library" as ZoneType,
      playerId: id,
      faceDown: true,
    })),
    commandZone: isCommander
      ? [
          {
            id: `${id}-commander-0`,
            card: {
              id: `commander-0`,
              name: "Commander",
              color_identity: [],
            },
            zone: "command" as ZoneType,
            playerId: id,
          },
        ]
      : [],
    isCurrentTurn: false,
    hasPriority: false,
  };
}

export default function GameBoardPage() {
  const [playerCount, setPlayerCount] = React.useState<PlayerCount>(2);
  const [currentTurnIndex, setCurrentTurnIndex] = React.useState(0);
  const [players, setPlayers] = React.useState<PlayerState[]>([]);
  const { toast } = useToast();

  // Initialize players when player count changes
  React.useEffect(() => {
    const newPlayers: PlayerState[] = [];

    if (playerCount === 2) {
      newPlayers.push(
        generateMockPlayer("player-1", "Opponent", 20, false),
        generateMockPlayer("player-2", "You", 20, false)
      );
    } else if (playerCount === 4) {
      newPlayers.push(
        generateMockPlayer("player-1", "Player 1", 40, true),
        generateMockPlayer("player-2", "Player 2", 40, true),
        generateMockPlayer("player-3", "Player 3", 40, true),
        generateMockPlayer("player-4", "You", 40, true)
      );
    }

    setPlayers(newPlayers);
    setCurrentTurnIndex(0);
  }, [playerCount]);

  const handleCardClick = (cardId: string, zone: ZoneType) => {
    toast({
      title: "Card Selected",
      description: `Clicked card ${cardId} in ${zone}`,
    });
  };

  const handleZoneClick = (zone: ZoneType, playerId: string) => {
    const player = players.find((p) => p.id === playerId);
    const zoneData = player?.[zone === "command" ? "commandZone" : zone];

    toast({
      title: `${zone.charAt(0).toUpperCase() + zone.slice(1)} Zone`,
      description: `${player?.name}'s ${zone}: ${zoneData?.length || 0} cards`,
    });
  };

  const advanceTurn = () => {
    const nextIndex = (currentTurnIndex + 1) % players.length;
    setCurrentTurnIndex(nextIndex);

    // Update isCurrentTurn flags
    setPlayers((prev) =>
      prev.map((player, idx) => ({
        ...player,
        isCurrentTurn: idx === nextIndex,
      }))
    );
  };

  const damagePlayer = (playerIndex: number, amount: number) => {
    setPlayers((prev) =>
      prev.map((player, idx) =>
        idx === playerIndex
          ? { ...player, lifeTotal: Math.max(0, player.lifeTotal - amount) }
          : player
      )
    );
  };

  const healPlayer = (playerIndex: number, amount: number) => {
    setPlayers((prev) =>
      prev.map((player, idx) =>
        idx === playerIndex
          ? { ...player, lifeTotal: player.lifeTotal + amount }
          : player
      )
    );
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar for controls */}
      <div className="w-80 border-r border-border/50 bg-card/50 p-4 overflow-y-auto">
        <div className="space-y-6">
          <div>
            <h1 className="font-headline text-2xl font-bold flex items-center gap-2">
              <Swords className="h-6 w-6" />
              Game Board
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Phase 2.1: Game Board Layout
            </p>
          </div>

          <Separator />

          {/* Configuration */}
          <div className="space-y-4">
            <h2 className="font-semibold text-sm">Configuration</h2>

            <div className="space-y-2">
              <Label htmlFor="player-count">Player Count</Label>
              <Select
                value={playerCount.toString()}
                onValueChange={(value) => setPlayerCount(Number(value) as PlayerCount)}
              >
                <SelectTrigger id="player-count">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 Players (1v1)</SelectItem>
                  <SelectItem value="4">4 Players (Commander)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={advanceTurn} className="w-full" variant="default">
              Advance Turn
            </Button>
          </div>

          <Separator />

          {/* Life Total Controls */}
          <div className="space-y-4">
            <h2 className="font-semibold text-sm">Life Total Controls</h2>

            {players.map((player, idx) => (
              <Card key={player.id} className={idx === players.length - 1 ? "border-primary/50" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    {player.name}
                    {player.isCurrentTurn && (
                      <span className="text-xs text-primary animate-pulse">Active</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-mono font-bold">{player.lifeTotal}</span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => damagePlayer(idx, 1)}
                      >
                        -1
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => healPlayer(idx, 1)}
                      >
                        +1
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => damagePlayer(idx, 5)}
                    >
                      -5
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => healPlayer(idx, 5)}
                    >
                      +5
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Separator />

          {/* Instructions */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Demo Controls
            </h2>
            <p className="text-xs text-muted-foreground">
              This is a demonstration of the game board layout with mock data.
              Click on zones and cards to interact with the board.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Hover over zones to see card counts</li>
              <li>Click zones to view detailed contents</li>
              <li>Use life total controls to simulate damage</li>
              <li>Advance turn to see active player indicator</li>
              <li>Try both 2-player and 4-player layouts</li>
            </ul>
          </div>

          <Separator />

          {/* Info */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Phase 2.1 Features:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Responsive 2-player layout</li>
              <li>Responsive 4-player Commander layout</li>
              <li>All game zones displayed</li>
              <li>Command zone support</li>
              <li>Life total tracking</li>
              <li>Poison counter display</li>
              <li>Commander damage tracking</li>
              <li>Active turn indicator</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Game Board */}
      <div className="flex-1 h-full">
        {players.length > 0 && (
          <GameBoard
            players={players}
            playerCount={playerCount}
            currentTurnIndex={currentTurnIndex}
            onCardClick={handleCardClick}
            onZoneClick={handleZoneClick}
          />
        )}
      </div>
    </div>
  );
}
