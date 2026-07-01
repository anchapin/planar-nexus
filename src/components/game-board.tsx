"use client";

import * as React from "react";
import { memo, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PlayerState,
  PlayerCount,
  ZoneType,
  TeamState,
  CardState,
} from "@/types/game";
import { HandDisplay } from "@/components/hand-display";
import {
  DamageOverlay,
  useDamageEvents,
  DamageEvent,
} from "@/components/damage-indicator";
import { GameAnnouncer } from "@/components/game-announcer";
import type {
  GameState as EngineGameState,
  PlayerId,
} from "@/lib/game-state/types";
import {
  Skull,
  Ban,
  Library,
  Hand,
  Swords,
  Heart,
  Skull as PoisonIcon,
  User,
  Crown,
  Flag,
  Handshake,
  X,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileGameLayout } from "@/components/mobile-game-layout";
import {
  BattlefieldCard,
  VirtualizedBattlefield,
} from "@/components/virtualized-battlefield";

// Performance optimization constants
// Only the visible window of battlefield permanents is mounted once a board
// exceeds this size; below it every permanent renders directly (no overhead).
// See #1082 — windowing the game-board permanent list for large board states.
const BATTLEFIELD_WINDOWING_THRESHOLD = 20;

interface GameBoardProps {
  players: PlayerState[];
  playerCount: PlayerCount;
  currentTurnIndex: number;
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  onZoneClick?: (zone: ZoneType, playerId: string) => void;
  // Concede and draw callbacks
  onConcede?: () => void;
  onOfferDraw?: () => void;
  onAcceptDraw?: () => void;
  onDeclineDraw?: () => void;
  // Game state for UI
  hasActiveDrawOffer?: boolean;
  hasPlayerOfferedDraw?: boolean;
  isGameOver?: boolean;
  // Team mode props
  isTeamMode?: boolean;
  teams?: TeamState[];
  teamSettings?: {
    sharedLife: boolean;
    sharedBlockers: boolean;
    teamChat: boolean;
  };
  // Damage indicator props
  damageEvents?: DamageEvent[];
  onDamageEventComplete?: (id: string) => void;
  // Accessibility (#1267) — passing engine state enables the GameAnnouncer
  // live region mounted next to the board. Both fields are optional; when
  // omitted the existing live region (which tracks the active player only)
  // remains in place and the announcer is inert.
  engineState?: EngineGameState | null;
  localPlayerId?: PlayerId | null;
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

// Card type for zone display - use CardState from game types
type ZoneCard = CardState;

// Memoized ZoneDisplay component for performance optimization
const ZoneDisplay = memo(function ZoneDisplay({
  zone,
  title,
  count,
  cards,
  bgColor = "bg-muted/50",
  size = "default",
  onCardClick,
  onZoneClick,
  playerId,
}: {
  zone: ZoneType;
  title: string;
  count: number;
  cards: ZoneCard[];
  bgColor?: string;
  size?: "small" | "default" | "large";
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  onZoneClick?: (zone: ZoneType, playerId: string) => void;
  playerId: string;
}) {
  const sizeClasses = {
    small: "h-12 min-h-[48px]",
    default: "h-16 min-h-[64px]",
    large: "h-24 min-h-[96px]",
  };

  const handleClick = useCallback(() => {
    onZoneClick?.(zone, playerId);
  }, [onZoneClick, zone, playerId]);

  // Window the battlefield once the board is large enough to matter (#1082).
  // Below the threshold every permanent renders directly; above it the
  // `VirtualizedBattlefield` mounts only the visible window (+ overscan) and
  // reveals the rest via horizontal scroll. This also replaces the previous
  // approach that silently sliced off overflow permanents (making them
  // untargetable); every permanent is now reachable by scroll.
  const isWindowedBattlefield =
    zone === "battlefield" && count > BATTLEFIELD_WINDOWING_THRESHOLD;

  const zoneIcons: Record<ZoneType, React.ReactNode> = useMemo(
    () => ({
      battlefield: null,
      hand: <Hand className="h-3 w-3" />,
      graveyard: <Skull className="h-3 w-3" />,
      exile: <Ban className="h-3 w-3" />,
      library: <Library className="h-3 w-3" />,
      commandZone: <Crown className="h-3 w-3" />,
      companion: <Crown className="h-3 w-3" />,
      stack: null,
      sideboard: null,
      anticipate: null,
    }),
    [],
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleClick}
            className={`w-full ${sizeClasses[size]} ${bgColor} border border-border/50 rounded-md hover:border-primary/50 transition-colors group relative min-h-[44px] touch-manipulation`}
            aria-label={`${title}: ${count} cards`}
            aria-expanded={count > 0}
            role="region"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }}
          >
            {count > 0 && (
              <div className="absolute inset-0 flex items-center justify-center gap-1 flex-wrap p-1">
                {zone === "battlefield" &&
                  (isWindowedBattlefield ? (
                    <VirtualizedBattlefield
                      cards={cards}
                      zone={zone}
                      onCardClick={onCardClick}
                      className="absolute inset-0 p-1"
                    />
                  ) : (
                    cards.map((card: ZoneCard, idx: number) => (
                      <BattlefieldCard
                        key={card.id || idx}
                        card={card}
                        zone={zone}
                        onCardClick={onCardClick}
                      />
                    ))
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
          <p>
            {title}: {count}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

// Memoized PlayerInfo component for performance optimization
interface PlayerInfoProps {
  player: PlayerState;
  isCurrentTurn: boolean;
  isVertical: boolean;
  otherPlayers?: PlayerState[];
}

const PlayerInfo = memo(function PlayerInfo({
  player,
  isVertical,
  otherPlayers = [],
}: PlayerInfoProps) {
  // Issue #24: Enhanced commander damage display - per opponent tracking
  const commanderDamageEntries = React.useMemo(() => {
    if (!player.commanderDamage) return [];
    return Object.entries(player.commanderDamage);
  }, [player.commanderDamage]);

  // Get player names for commander damage targets
  const getPlayerName = (playerId: string) => {
    const targetPlayer = otherPlayers.find((p) => p.id === playerId);
    return targetPlayer?.name || "Unknown";
  };

  // Check if any commander damage is fatal (21+ damage)
  const hasFatalCommanderDamage = commanderDamageEntries.some(
    ([, damage]) => damage >= 21,
  );

  return (
    <div
      className={`flex items-center gap-1.5 ${isVertical ? "flex-col" : ""}`}
    >
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 text-xs">
          <User className="h-3 w-3" />
          <span className="font-semibold">{player.name}</span>
        </div>
      </div>
      <Separator
        orientation={isVertical ? "horizontal" : "vertical"}
        className="h-4"
      />
      <div className="flex items-center gap-2 flex-wrap justify-center">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1 text-xs">
                <Heart
                  className={`h-3 w-3 ${hasFatalCommanderDamage ? "text-red-600 animate-pulse" : "text-red-500"}`}
                />
                <span
                  className={`font-mono font-bold ${hasFatalCommanderDamage ? "text-red-600" : ""}`}
                >
                  {player.lifeTotal}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Life Total: {player.lifeTotal}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {player.poisonCounters >= 10 && (
          <Badge variant="destructive" className="text-xs">
            <PoisonIcon className="h-3 w-3 mr-1" />
            {player.poisonCounters} Poison
          </Badge>
        )}

        {/* Issue #24: Commander damage per opponent display */}
        {commanderDamageEntries.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <div className="flex items-center gap-1 flex-wrap justify-center">
                  {commanderDamageEntries.map(([targetId, damage]) => (
                    <Badge
                      key={targetId}
                      variant={damage >= 21 ? "destructive" : "outline"}
                      className="text-xs"
                    >
                      {getPlayerName(targetId)}: {damage}
                    </Badge>
                  ))}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <p className="font-bold mb-1">Commander Damage</p>
                  {commanderDamageEntries.map(([targetId, damage]) => (
                    <p key={targetId}>
                      {getPlayerName(targetId)}: {damage}/21
                      {damage >= 21 && " (DEFEATED)"}
                    </p>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
});

function PlayerArea({
  player,
  isCurrentTurn,
  position,
  onCardClick,
  onZoneClick,
  orientation = "horizontal",
  allPlayers = [],
}: PlayerAreaProps & { allPlayers?: PlayerState[] }) {
  const isBottom = position === "bottom";
  const isVertical = orientation === "vertical";
  const [selectedHandCards, setSelectedHandCards] = React.useState<string[]>(
    [],
  );

  // Memoize handlers to prevent unnecessary re-renders
  const handleZoneClick = useCallback(
    (zone: ZoneType) => {
      onZoneClick?.(zone, player.id);
    },
    [onZoneClick, player.id],
  );

  const handleCardClick = useCallback(
    (cardId: string, zone: ZoneType) => {
      onCardClick?.(cardId, zone);
    },
    [onCardClick],
  );

  // Local ZoneDisplay wrapper for backward compatibility
  const ZoneDisplayLocal = ({
    zone,
    title,
    count,
    cards,
    bgColor = "bg-muted/50",
    size = "default",
  }: {
    zone: ZoneType;
    title: string;
    count: number;
    cards: ZoneCard[];
    bgColor?: string;
    size?: "small" | "default" | "large";
  }) => (
    <ZoneDisplay
      zone={zone}
      title={title}
      count={count}
      cards={cards}
      bgColor={bgColor}
      size={size}
      onCardClick={handleCardClick}
      onZoneClick={handleZoneClick}
      playerId={player.id}
    />
  );

  return (
    <div
      className="flex flex-col gap-2 h-full"
      data-testid={`player-area-${player.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      <PlayerInfo
        player={player}
        isCurrentTurn={isCurrentTurn}
        isVertical={isVertical}
        otherPlayers={allPlayers.filter((p) => p.id !== player.id)}
      />

      {/* Command Zone - always visible for Commander format */}
      {player.commandZone.length > 0 && (
        <ZoneDisplayLocal
          zone="commandZone"
          title="Leader Zone"
          count={player.commandZone.length}
          cards={player.commandZone}
          bgColor="bg-yellow-500/10"
          size="small"
        />
      )}

      {/* Main layout based on orientation */}
      {isVertical ? (
        <div className="grid grid-rows-2 gap-2 flex-1 min-h-0">
          <div className="flex flex-col gap-2">
            <ZoneDisplayLocal
              zone="library"
              title="Draw Pile"
              count={player.library.length}
              cards={player.library}
              bgColor="bg-blue-500/10"
              size="small"
            />
            <ZoneDisplayLocal
              zone="graveyard"
              title="Discard Pile"
              count={player.graveyard.length}
              cards={player.graveyard}
              bgColor="bg-stone-500/10"
              size="small"
            />
            <ZoneDisplayLocal
              zone="exile"
              title="Banish Zone"
              count={player.exile.length}
              cards={player.exile}
              bgColor="bg-sky-500/10"
              size="small"
            />
          </div>
          <ZoneDisplayLocal
            zone="battlefield"
            title="Game Board"
            count={player.battlefield.length}
            cards={player.battlefield}
            bgColor="bg-green-500/10"
            size="large"
          />
        </div>
      ) : (
        <div
          className={`grid ${isBottom ? "grid-rows-[1fr_auto_auto]" : "grid-rows-[auto_auto_1fr]"} gap-1.5 flex-1 min-h-0`}
        >
          <div
            className={`${isBottom ? "row-start-3 z-10 overflow-visible" : "z-0"}`}
          >
            {isBottom ? (
              <div
                className="bg-primary/5 border border-primary/20 rounded-md p-1.5 overflow-visible"
                data-tutorial="your-hand"
              >
                <HandDisplay
                  cards={player.hand}
                  isCurrentPlayer={true}
                  onCardSelect={setSelectedHandCards}
                  onCardClick={(cardId) => onCardClick?.(cardId, "hand")}
                  selectedCardIds={selectedHandCards}
                  className="min-h-[120px]"
                />
              </div>
            ) : (
              <ZoneDisplayLocal
                zone="hand"
                title="Hand"
                count={player.hand.length}
                cards={player.hand}
                bgColor="bg-primary/10"
                size="small"
              />
            )}
          </div>

          <div
            className={`grid grid-cols-2 md:grid-cols-4 gap-1.5 ${isBottom ? "row-start-2 z-0" : "z-0"}`}
            data-tutorial={isBottom ? "zones" : undefined}
          >
            <ZoneDisplayLocal
              zone="library"
              title="Draw Pile"
              count={player.library.length}
              cards={player.library}
              bgColor="bg-blue-500/10"
              size="small"
            />
            <ZoneDisplayLocal
              zone="graveyard"
              title="Discard Pile"
              count={player.graveyard.length}
              cards={player.graveyard}
              bgColor="bg-stone-500/10"
              size="small"
            />
            <ZoneDisplayLocal
              zone="exile"
              title="Banish Zone"
              count={player.exile.length}
              cards={player.exile}
              bgColor="bg-sky-500/10"
              size="small"
            />
            {!isBottom && (
              <ZoneDisplayLocal
                zone="hand"
                title="Hand"
                count={player.hand.length}
                cards={player.hand}
                bgColor="bg-primary/10"
                size="small"
              />
            )}
          </div>

          <div className={isBottom ? "row-start-1" : ""}>
            <ZoneDisplayLocal
              zone="battlefield"
              title="Game Board"
              count={player.battlefield.length}
              cards={player.battlefield}
              bgColor="bg-green-500/10"
              size="large"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function GameBoard({
  players,
  playerCount,
  currentTurnIndex,
  onCardClick,
  onZoneClick,
  onConcede,
  onOfferDraw,
  onAcceptDraw,
  onDeclineDraw,
  hasActiveDrawOffer = false,
  hasPlayerOfferedDraw = false,
  isGameOver = false,
  damageEvents = [],
  onDamageEventComplete,
  engineState = null,
  localPlayerId = null,
}: GameBoardProps) {
  const isMobile = useIsMobile();
  const currentPlayer = players[currentTurnIndex];

  // Dialog states
  const [showConcedeDialog, setShowConcedeDialog] = React.useState(false);

  // Internal damage events state if not provided externally
  const internalDamageEvents = useDamageEvents({ maxEvents: 15 });
  const activeDamageEvents =
    damageEvents.length > 0 ? damageEvents : internalDamageEvents.events;
  const handleDamageEventComplete =
    onDamageEventComplete || internalDamageEvents.clearEvents;

  // Mobile layout — vertically-stacked, scrollable, touch-friendly
  if (isMobile) {
    return (
      <MobileGameLayout
        players={players}
        playerCount={playerCount}
        currentTurnIndex={currentTurnIndex}
        onCardClick={onCardClick}
        onZoneClick={onZoneClick}
        onConcede={onConcede}
        onOfferDraw={onOfferDraw}
        onAcceptDraw={onAcceptDraw}
        onDeclineDraw={onDeclineDraw}
        hasActiveDrawOffer={hasActiveDrawOffer}
        hasPlayerOfferedDraw={hasPlayerOfferedDraw}
        isGameOver={isGameOver}
        damageEvents={activeDamageEvents}
        onDamageEventComplete={handleDamageEventComplete}
      />
    );
  }

  // Layout strategy based on player count
  const renderLayout = () => {
    if (playerCount === 2) {
      const topPlayer = players[0];
      const bottomPlayer = players[1];

      return (
        <div className="grid grid-rows-[1fr_auto_1fr] gap-1.5 h-full min-h-0 overflow-visible">
          <Card className="border-border/50 flex flex-col min-h-0">
            <CardContent className="p-2 flex-1 min-h-0">
              <PlayerArea
                player={topPlayer}
                isCurrentTurn={currentTurnIndex === 0}
                position="top"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="horizontal"
                isLocalPlayer={false}
                allPlayers={players}
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-center">
            <Badge variant="outline" className="px-4 py-2 text-lg">
              <Swords className="h-4 w-4 mr-2" />
              Turn {currentPlayer?.name}
            </Badge>
          </div>

          <Card className="border-2 border-primary/20 flex flex-col min-h-0">
            <CardContent className="p-2 flex-1 min-h-0">
              <PlayerArea
                player={bottomPlayer}
                isCurrentTurn={currentTurnIndex === 1}
                position="bottom"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="horizontal"
                isLocalPlayer={true}
                allPlayers={players}
              />
            </CardContent>
          </Card>
        </div>
      );
    }

    if (playerCount === 4) {
      const topPlayer = players[0];
      const leftPlayer = players[1];
      const rightPlayer = players[2];
      const bottomPlayer = players[3];

      return (
        <div className="grid grid-cols-[200px_1fr_200px] grid-rows-[1fr_1fr] gap-1.5 h-full min-h-0">
          <Card className="col-start-2 col-span-1 border-border/50 flex flex-col min-h-0">
            <CardContent className="p-2 flex-1 min-h-0">
              <PlayerArea
                player={topPlayer}
                isCurrentTurn={currentTurnIndex === 0}
                position="top"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="horizontal"
                isLocalPlayer={false}
                allPlayers={players}
              />
            </CardContent>
          </Card>

          <Card className="row-start-2 row-span-2 col-start-1 border-border/50 flex flex-col min-h-0">
            <CardContent className="p-2 flex-1 min-h-0">
              <PlayerArea
                player={leftPlayer}
                isCurrentTurn={currentTurnIndex === 1}
                position="left"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="vertical"
                isLocalPlayer={false}
                allPlayers={players}
              />
            </CardContent>
          </Card>

          <Card className="row-start-2 row-span-1 col-start-2 col-span-1 border-border/30 bg-muted/30 flex flex-col min-h-0 overflow-hidden">
            <CardContent className="p-2 h-full flex items-center justify-center">
              <div className="text-center space-y-1">
                <Badge variant="outline" className="px-3 py-1 text-xs">
                  <Swords className="h-3 w-3 mr-2" />
                  {currentPlayer?.name}'s Turn
                </Badge>
                <div className="text-[10px] text-muted-foreground">
                  Spell Chain: 0 items
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="row-start-2 row-span-2 col-start-3 border-border/50 flex flex-col min-h-0">
            <CardContent className="p-2 flex-1 min-h-0">
              <PlayerArea
                player={rightPlayer}
                isCurrentTurn={currentTurnIndex === 2}
                position="right"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="vertical"
                isLocalPlayer={false}
                allPlayers={players}
              />
            </CardContent>
          </Card>

          <Card className="row-start-2 row-span-1 col-start-2 col-span-1 border-2 border-primary/20 flex flex-col min-h-0">
            <CardContent className="p-2 flex-1 min-h-0">
              <PlayerArea
                player={bottomPlayer}
                isCurrentTurn={currentTurnIndex === 3}
                position="bottom"
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                orientation="horizontal"
                isLocalPlayer={true}
                allPlayers={players}
              />
            </CardContent>
          </Card>
        </div>
      );
    }

    return null;
  };

  return (
    <div
      className="w-full h-full p-1 bg-background overflow-visible"
      role="application"
      aria-label="Game Board"
    >
      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {currentPlayer && `It is ${currentPlayer.name}'s turn`}
      </div>

      {/* #1267 — Game-state announcer (turn / phase / priority / life). Owns
          its own live region so a transition can interrupt the more generic
          "It is X's turn" line above. Inert when engineState is omitted. */}
      <GameAnnouncer engineState={engineState} localPlayerId={localPlayerId} />

      {/* Skip to main content link for keyboard users */}
      <a
        href="#game-board-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md"
      >
        Skip to game board
      </a>

      {/* Game Controls - Concede and Draw options */}
      {!isGameOver && (
        <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
          {/* Draw offer notification */}
          {hasActiveDrawOffer && (
            <div className="bg-amber-500/90 text-amber-foreground px-4 py-2 rounded-md shadow-lg flex items-center gap-2">
              <Handshake className="h-4 w-4" />
              <span className="text-sm font-medium">Draw offer pending</span>
              <div className="flex gap-1 ml-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onAcceptDraw}
                  className="h-7 px-2"
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onDeclineDraw}
                  className="h-7 px-2"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}

          {/* Your draw offer is active */}
          {hasPlayerOfferedDraw && !hasActiveDrawOffer && (
            <div className="bg-blue-500/90 text-blue-foreground px-4 py-2 rounded-md shadow-lg flex items-center gap-2">
              <Handshake className="h-4 w-4" />
              <span className="text-sm font-medium">Draw offer sent</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowConcedeDialog(true)}
                    disabled={!onConcede}
                    className="bg-background/80"
                  >
                    <Flag className="h-4 w-4 mr-1" />
                    Concede
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Concede the game</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOfferDraw}
                    disabled={!onOfferDraw || hasPlayerOfferedDraw}
                    className="bg-background/80"
                  >
                    <Handshake className="h-4 w-4 mr-1" />
                    Offer Draw
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Offer a draw to all players</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      )}

      {renderLayout()}

      {/* Damage Indicators Overlay */}
      <DamageOverlay
        events={activeDamageEvents}
        onEventComplete={handleDamageEventComplete}
      />

      {/* Concede Confirmation Dialog */}
      <Dialog open={showConcedeDialog} onOpenChange={setShowConcedeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Concede Game?</DialogTitle>
            <DialogDescription>
              Are you sure you want to concede? You will lose the game
              immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConcedeDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onConcede?.();
                setShowConcedeDialog(false);
              }}
            >
              Concede
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
