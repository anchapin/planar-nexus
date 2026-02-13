"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PlayerState, PlayerCount, ZoneType } from "@/types/game";
import { HandDisplay } from "@/components/hand-display";
import {
  Skull,
  Archive,
  Ban,
  Library,
  Hand,
  Swords,
  Heart,
  Skull as PoisonIcon,
  ChevronDown,
  ChevronUp,
  User,
  Crown
} from "lucide-react";

interface GameBoardProps {
  players: PlayerState[];
  playerCount: PlayerCount;
  currentTurnIndex: number;
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  onZoneClick?: (zone: ZoneType, playerId: string) => void;
}

interface PlayerAreaProps {
  player: PlayerState;
  isCurrentTurn: boolean;
  position: "top" | "bottom" | "left" | "right";
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  onZoneClick?: (zone: ZoneType, playerId: string) => void;
  orientation?: "horizontal" | "vertical";
  isLocalPlayer?: boolean;
}

function PlayerArea({ player, isCurrentTurn, position, onCardClick, onZoneClick, orientation = "horizontal", isLocalPlayer = false }: PlayerAreaProps) {
  const isBottom = position === "bottom";
  const isVertical = orientation === "vertical";
  const [selectedHandCards, setSelectedHandCards] = React.useState<string[]>([]);

  const zoneIcons: Record<ZoneType, React.ReactNode> = {
    battlefield: null,
    hand: <Hand className="h-3 w-3" />,
    graveyard: <Skull className="h-3 w-3" />,
    exile: <Ban className="h-3 w-3" />,
    library: <Library className="h-3 w-3" />,
    command: <Crown className="h-3 w-3" />,
  };

  const ZoneDisplay = ({
    zone,
    title,
    count,
    cards,
    bgColor = "bg-muted/50",
    size = "default"
  }: {
    zone: ZoneType;
    title: string;
    count: number;
    cards: any[];
    bgColor?: string;
    size?: "small" | "default" | "large";
  }) => {
    const sizeClasses = {
      small: "h-16 min-h-16",
      default: "h-24 min-h-24",
      large: "h-32 min-h-32"
    };

    const handleClick = () => {
      onZoneClick?.(zone, player.id);
    };

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleClick}
              className={`w-full ${sizeClasses[size]} ${bgColor} border border-border/50 rounded-md hover:border-primary/50 transition-colors group relative`}
            >
              {count > 0 && (
                <div className="absolute inset-0 flex items-center justify-center gap-1 flex-wrap p-1">
                  {zone === "battlefield" && cards.slice(0, 7).map((card, idx) => (
                    <div
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCardClick?.(card.id, zone);
                      }}
                      className="w-10 h-14 bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 rounded hover:from-primary/40 hover:scale-105 transition-all cursor-pointer"
                    />
                  ))}
                  {zone !== "battlefield" && (
                    <div className="flex items-center gap-1">
                      {zoneIcons[zone]}
                      <span className="text-sm font-medium">{count}</span>
                    </div>
                  )}
                </div>
              )}
              {count === 0 && (
                <div className="absolute inset-0 flex items-center justify-center opacity-30">
                  {zoneIcons[zone]}
                </div>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{title}: {count}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const PlayerInfo = () => (
    <div className={`flex items-center gap-2 ${isVertical ? "flex-col" : ""}`}>
      <div className="flex items-center gap-2">
        {isCurrentTurn && (
          <Badge variant="default" className="animate-pulse">
            <Crown className="h-3 w-3 mr-1" />
            Active
          </Badge>
        )}
        <div className="flex items-center gap-1 text-sm">
          <User className="h-4 w-4" />
          <span className="font-medium">{player.name}</span>
        </div>
      </div>
      <Separator orientation={isVertical ? "horizontal" : "vertical"} className="h-6" />
      <div className="flex items-center gap-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1 text-sm">
                <Heart className="h-4 w-4 text-red-500" />
                <span className="font-mono font-bold">{player.lifeTotal}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Life Total</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {player.poisonCounters > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <div className="flex items-center gap-1 text-sm">
                  <PoisonIcon className="h-4 w-4 text-purple-500" />
                  <span className="font-mono font-bold">{player.poisonCounters}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Poison Counters</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {player.commanderDamage && Object.keys(player.commanderDamage).length > 0 && (
          <Badge variant="outline" className="text-xs">
            CMDR: {Object.values(player.commanderDamage)[0]}
          </Badge>
        )}
      </div>
    </div>
  );

  return (
    <div className={`flex flex-col gap-2 ${isVertical ? "h-full" : ""}`}>
      <PlayerInfo />

      {/* Command Zone - always visible for Commander format */}
      {player.commandZone.length > 0 && (
        <ZoneDisplay
          zone="command"
          title="Command Zone"
          count={player.commandZone.length}
          cards={player.commandZone}
          bgColor="bg-yellow-500/10"
          size="small"
        />
      )}

      {/* Main layout based on orientation */}
      {isVertical ? (
        // Vertical layout (left/right players in 4-player)
        <div className="grid grid-rows-2 gap-2 flex-1 min-h-0">
          <div className="flex flex-col gap-2">
            <ZoneDisplay
              zone="library"
              title="Library"
              count={player.library.length}
              cards={player.library}
              bgColor="bg-blue-500/10"
              size="small"
            />
            <ZoneDisplay
              zone="graveyard"
              title="Graveyard"
              count={player.graveyard.length}
              cards={player.graveyard}
              bgColor="bg-stone-500/10"
              size="small"
            />
            <ZoneDisplay
              zone="exile"
              title="Exile"
              count={player.exile.length}
              cards={player.exile}
              bgColor="bg-sky-500/10"
              size="small"
            />
          </div>
          <ZoneDisplay
            zone="battlefield"
            title="Battlefield"
            count={player.battlefield.length}
            cards={player.battlefield}
            bgColor="bg-green-500/10"
            size="large"
          />
        </div>
      ) : (
        // Horizontal layout (top/bottom players)
        <div className={`grid ${isBottom ? "grid-rows-[auto_1fr_auto]" : "grid-rows-[auto_1fr_auto]"} gap-2 flex-1 min-h-0`}>
          {/* Hand - use HandDisplay component for current player, simple zone for opponents */}
          {isBottom ? (
            <div className="bg-primary/5 border border-primary/20 rounded-md p-2">
              <HandDisplay
                cards={player.hand}
                isCurrentPlayer={true}
                onCardSelect={setSelectedHandCards}
                onCardClick={(cardId) => onCardClick?.(cardId, "hand")}
                selectedCardIds={selectedHandCards}
                className="min-h-[140px]"
              />
            </div>
          ) : (
            <ZoneDisplay
              zone="hand"
              title="Hand"
              count={player.hand.length}
              cards={player.hand}
              bgColor="bg-primary/10"
              size="small"
            />
          )}

          {/* Other zones row */}
          <div className="grid grid-cols-4 gap-2">
            <ZoneDisplay
              zone="library"
              title="Library"
              count={player.library.length}
              cards={player.library}
              bgColor="bg-blue-500/10"
              size="small"
            />
            <ZoneDisplay
              zone="graveyard"
              title="Graveyard"
              count={player.graveyard.length}
              cards={player.graveyard}
              bgColor="bg-stone-500/10"
              size="small"
            />
            <ZoneDisplay
              zone="exile"
              title="Exile"
              count={player.exile.length}
              cards={player.exile}
              bgColor="bg-sky-500/10"
              size="small"
            />
            {!isBottom && (
              <ZoneDisplay
                zone="hand"
                title="Hand"
                count={player.hand.length}
                cards={player.hand}
                bgColor="bg-primary/10"
                size="small"
              />
            )}
          </div>

          {/* Battlefield */}
          <ZoneDisplay
            zone="battlefield"
            title="Battlefield"
            count={player.battlefield.length}
            cards={player.battlefield}
            bgColor="bg-green-500/10"
            size="large"
          />
        </div>
      )}
    </div>
  );
}

export function GameBoard({ players, playerCount, currentTurnIndex, onCardClick, onZoneClick }: GameBoardProps) {
  const currentPlayer = players[currentTurnIndex];

  // Layout strategy based on player count
  const renderLayout = () => {
    if (playerCount === 2) {
      // Top/bottom split for 2-player
      const topPlayer = players[0];
      const bottomPlayer = players[1];

      return (
        <div className="grid grid-rows-[1fr_auto_1fr] gap-4 h-full">
          {/* Top player */}
          <Card className="border-border/50">
            <CardContent className="p-4 h-full">
              <PlayerArea
                player={topPlayer}
                isCurrentTurn={currentTurnIndex === 0}
                position="top"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="horizontal"
                isLocalPlayer={false}
              />
            </CardContent>
          </Card>

          {/* Stack/turn info in middle */}
          <div className="flex items-center justify-center">
            <Badge variant="outline" className="px-4 py-2 text-lg">
              <Swords className="h-4 w-4 mr-2" />
              Turn {currentPlayer?.name}
            </Badge>
          </div>

          {/* Bottom player (you) */}
          <Card className="border-2 border-primary/20">
            <CardContent className="p-4 h-full">
              <PlayerArea
                player={bottomPlayer}
                isCurrentTurn={currentTurnIndex === 1}
                position="bottom"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="horizontal"
                isLocalPlayer={true}
              />
            </CardContent>
          </Card>
        </div>
      );
    }

    if (playerCount === 4) {
      // 4-player Commander layout: top, left, right, bottom
      const topPlayer = players[0];
      const leftPlayer = players[1];
      const rightPlayer = players[2];
      const bottomPlayer = players[3];

      return (
        <div className="grid grid-cols-[200px_1fr_200px] grid-rows-[1fr_1fr] gap-2 h-full">
          {/* Top player */}
          <Card className="col-start-2 col-span-1 border-border/50">
            <CardContent className="p-3 h-full">
              <PlayerArea
                player={topPlayer}
                isCurrentTurn={currentTurnIndex === 0}
                position="top"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="horizontal"
                isLocalPlayer={false}
              />
            </CardContent>
          </Card>

          {/* Left player */}
          <Card className="row-start-2 row-span-2 col-start-1 border-border/50">
            <CardContent className="p-3 h-full">
              <PlayerArea
                player={leftPlayer}
                isCurrentTurn={currentTurnIndex === 1}
                position="left"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="vertical"
                isLocalPlayer={false}
              />
            </CardContent>
          </Card>

          {/* Center battlefield/stack area */}
          <Card className="row-start-2 row-span-1 col-start-2 col-span-1 border-border/30 bg-muted/30">
            <CardContent className="p-4 h-full flex items-center justify-center">
              <div className="text-center space-y-2">
                <Badge variant="outline" className="px-4 py-2 text-sm">
                  <Swords className="h-3 w-3 mr-2" />
                  {currentPlayer?.name}'s Turn
                </Badge>
                <div className="text-xs text-muted-foreground">
                  Stack: 0 items
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Right player */}
          <Card className="row-start-2 row-span-2 col-start-3 border-border/50">
            <CardContent className="p-3 h-full">
              <PlayerArea
                player={rightPlayer}
                isCurrentTurn={currentTurnIndex === 2}
                position="right"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="vertical"
                isLocalPlayer={false}
              />
            </CardContent>
          </Card>

          {/* Bottom player (you) */}
          <Card className="row-start-2 row-span-1 col-start-2 col-span-1 border-2 border-primary/20">
            <CardContent className="p-3 h-full">
              <PlayerArea
                player={bottomPlayer}
                isCurrentTurn={currentTurnIndex === 3}
                position="bottom"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="horizontal"
                isLocalPlayer={true}
              />
            </CardContent>
          </Card>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="w-full h-full p-4 bg-background">
      {renderLayout()}
    </div>
  );
}
