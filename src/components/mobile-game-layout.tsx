"use client";

import * as React from "react";
import { useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PlayerState,
  PlayerCount,
  ZoneType,
  CardState,
} from "@/types/game";
import { HandDisplay } from "@/components/hand-display";
import {
  DamageOverlay,
  DamageEvent,
  useDamageEvents,
} from "@/components/damage-indicator";
import Image from "next/image";
import {
  Skull,
  Ban,
  Library,
  Hand,
  Swords,
  Heart,
  Skull as PoisonIcon,
  Crown,
  Flag,
  Handshake,
  X,
} from "lucide-react";

interface MobileGameLayoutProps {
  players: PlayerState[];
  playerCount: PlayerCount;
  currentTurnIndex: number;
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  onZoneClick?: (zone: ZoneType, playerId: string) => void;
  onConcede?: () => void;
  onOfferDraw?: () => void;
  onAcceptDraw?: () => void;
  onDeclineDraw?: () => void;
  hasActiveDrawOffer?: boolean;
  hasPlayerOfferedDraw?: boolean;
  isGameOver?: boolean;
  damageEvents?: DamageEvent[];
  onDamageEventComplete?: (id: string) => void;
}

type ZoneCard = CardState;

const zoneIcons: Record<ZoneType, React.ReactNode> = {
  battlefield: null,
  hand: <Hand className="h-4 w-4" />,
  graveyard: <Skull className="h-4 w-4" />,
  exile: <Ban className="h-4 w-4" />,
  library: <Library className="h-4 w-4" />,
  commandZone: <Crown className="h-4 w-4" />,
  companion: <Crown className="h-4 w-4" />,
  stack: null,
  sideboard: null,
  anticipate: null,
};

/**
 * MobileZone — a touch-friendly zone button (min 48px tap target).
 * Renders a compact count badge with icon; tapping opens the zone.
 */
function MobileZone({
  zone,
  title,
  count,
  cards,
  bgColor = "bg-muted/50",
  onCardClick,
  onZoneClick,
  playerId,
}: {
  zone: ZoneType;
  title: string;
  count: number;
  cards: ZoneCard[];
  bgColor?: string;
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  onZoneClick?: (zone: ZoneType, playerId: string) => void;
  playerId: string;
}) {
  const handleClick = useCallback(() => {
    onZoneClick?.(zone, playerId);
  }, [onZoneClick, zone, playerId]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleClick}
            className={`w-full min-h-[48px] ${bgColor} border border-border/50 rounded-lg hover:border-primary/50 active:bg-primary/10 transition-colors flex items-center justify-center gap-1.5 px-2 py-2 touch-manipulation`}
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
            {zoneIcons[zone]}
            <span className="flex flex-col items-center leading-none">
              <span className="text-[10px] text-muted-foreground">{title}</span>
              <span className="text-base font-bold tabular-nums">{count}</span>
            </span>
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
}

/**
 * MobilePlayerInfo — compact player status bar.
 */
function MobilePlayerInfo({
  player,
  isCurrentTurn,
}: {
  player: PlayerState;
  isCurrentTurn: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        <span
          className={`font-semibold text-sm ${isCurrentTurn ? "text-primary" : ""}`}
        >
          {player.name}
        </span>
        {isCurrentTurn && (
          <Badge variant="default" className="text-[9px] h-4 px-1">
            <Swords className="h-2.5 w-2.5 mr-0.5" />
            Turn
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Badge
          variant={player.lifeTotal <= 5 ? "destructive" : "outline"}
          className="text-xs gap-1"
        >
          <Heart className="h-3 w-3" />
          {player.lifeTotal}
        </Badge>
        {player.poisonCounters > 0 && (
          <Badge variant="destructive" className="text-xs gap-1">
            <PoisonIcon className="h-3 w-3" />
            {player.poisonCounters}
          </Badge>
        )}
      </div>
    </div>
  );
}

/**
 * MobilePlayerArea — a single player's zone rendered for mobile.
 * Zones are arranged in a 2-column grid; the local player's hand is
 * shown as a horizontally-scrollable strip.
 */
function MobilePlayerArea({
  player,
  isCurrentTurn,
  isLocalPlayer,
  onCardClick,
  onZoneClick,
  allPlayers,
}: {
  player: PlayerState;
  isCurrentTurn: boolean;
  isLocalPlayer: boolean;
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  onZoneClick?: (zone: ZoneType, playerId: string) => void;
  allPlayers: PlayerState[];
}) {
  const [selectedHandCards, setSelectedHandCards] = React.useState<string[]>(
    [],
  );

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

  const ZoneButton = ({
    zone,
    title,
    count,
    cards,
    bgColor,
  }: {
    zone: ZoneType;
    title: string;
    count: number;
    cards: ZoneCard[];
    bgColor: string;
  }) => (
    <MobileZone
      zone={zone}
      title={title}
      count={count}
      cards={cards}
      bgColor={bgColor}
      onCardClick={handleCardClick}
      onZoneClick={handleZoneClick}
      playerId={player.id}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <MobilePlayerInfo player={player} isCurrentTurn={isCurrentTurn} />

      {/* Command Zone */}
      {player.commandZone.length > 0 && (
        <ZoneButton
          zone="commandZone"
          title="Leader"
          count={player.commandZone.length}
          cards={player.commandZone}
          bgColor="bg-yellow-500/10"
        />
      )}

      {/* Battlefield — full width */}
      <ZoneButton
        zone="battlefield"
        title="Battlefield"
        count={player.battlefield.length}
        cards={player.battlefield}
        bgColor="bg-green-500/10"
      />

      {/* Other zones — 2-column grid */}
      <div className="grid grid-cols-2 gap-2">
        <ZoneButton
          zone="library"
          title="Draw Pile"
          count={player.library.length}
          cards={player.library}
          bgColor="bg-blue-500/10"
        />
        <ZoneButton
          zone="graveyard"
          title="Discard"
          count={player.graveyard.length}
          cards={player.graveyard}
          bgColor="bg-stone-500/10"
        />
        <ZoneButton
          zone="exile"
          title="Exile"
          count={player.exile.length}
          cards={player.exile}
          bgColor="bg-sky-500/10"
        />
        {!isLocalPlayer && (
          <ZoneButton
            zone="hand"
            title="Hand"
            count={player.hand.length}
            cards={player.hand}
            bgColor="bg-primary/10"
          />
        )}
      </div>

      {/* Local player's hand — scrollable */}
      {isLocalPlayer && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-2">
          <HandDisplay
            cards={player.hand}
            isCurrentPlayer={true}
            onCardSelect={setSelectedHandCards}
            onCardClick={(cardId) => onCardClick?.(cardId, "hand")}
            selectedCardIds={selectedHandCards}
            className="min-h-[100px]"
          />
        </div>
      )}
    </div>
  );
}

/**
 * MobileGameLayout — vertically-stacked, scrollable game board for phones.
 *
 * Each player area is rendered as a Card in a vertical scroll container.
 * The local player (last in the list) gets an expanded hand display.
 * All interactive elements meet the 44px minimum tap-target guideline.
 */
export function MobileGameLayout({
  players,
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
}: MobileGameLayoutProps) {
  const [showConcedeDialog, setShowConcedeDialog] = React.useState(false);
  const localPlayerIndex = players.length - 1;

  const internalDamageEvents = useDamageEvents({ maxEvents: 15 });
  const activeDamageEvents =
    damageEvents.length > 0 ? damageEvents : internalDamageEvents.events;
  const handleDamageEventComplete =
    onDamageEventComplete || internalDamageEvents.clearEvents;

  return (
    <div
      className="relative w-full h-full bg-background flex flex-col overflow-hidden"
      role="application"
      aria-label="Game Board (Mobile)"
      data-testid="mobile-game-layout"
    >
      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {players[currentTurnIndex] &&
          `It is ${players[currentTurnIndex].name}'s turn`}
      </div>

      {/* Game Controls — fixed at top, touch-friendly */}
      {!isGameOver && (
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-2 py-2 border-b bg-background/95 backdrop-blur">
          <Badge variant="outline" className="px-3 py-1.5 text-sm">
            <Swords className="h-4 w-4 mr-1.5" />
            {players[currentTurnIndex]?.name}&apos;s Turn
          </Badge>

          <div className="flex items-center gap-2">
            {/* Draw offer notification */}
            {hasActiveDrawOffer && (
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onAcceptDraw}
                  className="h-11 min-w-[44px] px-3"
                >
                  <Handshake className="h-4 w-4 mr-1" />
                  Accept
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDeclineDraw}
                  className="h-11 w-11 p-0"
                  aria-label="Decline draw"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            {hasPlayerOfferedDraw && !hasActiveDrawOffer && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Handshake className="h-3 w-3" />
                Draw sent
              </Badge>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConcedeDialog(true)}
              disabled={!onConcede}
              className="h-11 min-w-[44px] px-3"
            >
              <Flag className="h-4 w-4 mr-1" />
              Concede
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onOfferDraw}
              disabled={!onOfferDraw || hasPlayerOfferedDraw}
              className="h-11 min-w-[44px] px-3"
            >
              <Handshake className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Scrollable player areas */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2"
        id="game-board-main"
      >
        {players.map((player, idx) => (
          <Card
            key={player.id}
            className={
              idx === localPlayerIndex
                ? "border-2 border-primary/30"
                : "border-border/50"
            }
            data-testid={`mobile-player-area-${player.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            <CardContent className="p-2.5">
              <MobilePlayerArea
                player={player}
                isCurrentTurn={currentTurnIndex === idx}
                isLocalPlayer={idx === localPlayerIndex}
                onCardClick={onCardClick}
                onZoneClick={onZoneClick}
                allPlayers={players}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Damage Indicators Overlay */}
      <DamageOverlay
        events={activeDamageEvents}
        onEventComplete={handleDamageEventComplete}
      />

      {/* Concede Confirmation Dialog */}
      <ConcedeDialog
        open={showConcedeDialog}
        onOpenChange={setShowConcedeDialog}
        onConfirm={() => {
          onConcede?.();
          setShowConcedeDialog(false);
        }}
      />
    </div>
  );
}

/**
 * Lightweight concede dialog for mobile.
 */
function ConcedeDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center ${open ? "" : "pointer-events-none"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Concede Game"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={() => onOpenChange(false)}
      />
      {/* Panel */}
      <div
        className={`relative w-full sm:max-w-md bg-background border rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 space-y-4 transition-transform ${open ? "translate-y-0" : "translate-y-full sm:translate-y-0 sm:opacity-0"}`}
      >
        <h2 className="text-lg font-semibold">Concede Game?</h2>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to concede? You will lose the game immediately.
        </p>
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1 h-12"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1 h-12"
            onClick={onConfirm}
          >
            Concede
          </Button>
        </div>
      </div>
    </div>
  );
}
