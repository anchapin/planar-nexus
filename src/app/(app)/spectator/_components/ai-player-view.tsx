/**
 * AI Player View Component
 * 
 * Displays a player's game state in spectator mode.
 * Shows life total, mana pool, hand count, battlefield, and library.
 */

'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Heart, Droplet, BookOpen, Grid3X3, Hand } from 'lucide-react';
import type { Player, GameState, PlayerId } from '@/lib/game-state/types';

interface AIPlayerViewProps {
  player: Player | null | undefined;
  gameState?: GameState | null;
  isOpponent?: boolean;
  isActiveTurn?: boolean;
}

/**
 * Mana symbol mapping
 */
const MANA_SYMBOLS: Record<string, string> = {
  white: '⬜',
  blue: '🔵',
  black: '⚫',
  red: '🔴',
  green: '🟢',
  colorless: '⚪',
};

/**
 * Color for mana symbols
 */
const MANA_COLORS: Record<string, string> = {
  white: 'bg-white text-black',
  blue: 'bg-blue-500 text-white',
  black: 'bg-gray-800 text-white',
  red: 'bg-red-500 text-white',
  green: 'bg-green-500 text-white',
  colorless: 'bg-gray-300 text-black',
};

/**
 * Get hand size for a player from game state
 */
function getHandSize(gameState: GameState | null | undefined, playerId: PlayerId): number {
  if (!gameState || !playerId) return 0;
  const handZone = gameState.zones.get(`${playerId}-hand`);
  return handZone?.cardIds.length || 0;
}

/**
 * Get battlefield count for a player from game state
 */
function getBattlefieldInfo(gameState: GameState | null | undefined, playerId: PlayerId): { total: number; untapped: number } {
  if (!gameState || !playerId) return { total: 0, untapped: 0 };
  const battlefieldZone = gameState.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone) return { total: 0, untapped: 0 };
  
  let total = 0;
  let untapped = 0;
  
  for (const cardId of battlefieldZone.cardIds) {
    const card = gameState.cards.get(cardId);
    if (card) {
      total++;
      if (!card.isTapped) untapped++;
    }
  }
  
  return { total, untapped };
}

/**
 * Get library count for a player from game state
 */
function getLibrarySize(gameState: GameState | null | undefined, playerId: PlayerId): number {
  if (!gameState || !playerId) return 0;
  const libraryZone = gameState.zones.get(`${playerId}-library`);
  return libraryZone?.cardIds.length || 0;
}

export function AIPlayerView({ player, gameState, isOpponent = false, isActiveTurn = false }: AIPlayerViewProps) {
  if (!player) {
    return null;
  }

  const borderColor = isOpponent ? 'border-red-500/50' : 'border-blue-500/50';
  const bgColor = isActiveTurn ? 'bg-muted/50' : '';
  const icon = isOpponent ? '🔴' : '🔵';

  // Calculate mana pool total
  const totalMana =
    player.manaPool.colorless +
    player.manaPool.white +
    player.manaPool.blue +
    player.manaPool.black +
    player.manaPool.red +
    player.manaPool.green;

  // Get available mana symbols
  const availableMana = Object.entries(player.manaPool)
    .filter(([_, count]) => count > 0)
    .map(([color, count]) => ({
      color,
      count,
      symbol: MANA_SYMBOLS[color as keyof typeof MANA_SYMBOLS] || '⚪',
      colorClass: MANA_COLORS[color as keyof typeof MANA_COLORS] || 'bg-gray-300',
    }));

  // Get zone counts from game state
  const handSize = getHandSize(gameState || null, player.id);
  const battlefieldInfo = getBattlefieldInfo(gameState || null, player.id);
  const librarySize = getLibrarySize(gameState || null, player.id);

  // Hand size progress (max 10 for visual)
  const handProgress = Math.min((handSize / 10) * 100, 100);

  return (
    <Card className={`p-4 mb-4 ${borderColor} ${bgColor} transition-colors`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>{icon}</span>
            <span>{player.name}</span>
          </div>
          {isActiveTurn && (
            <Badge variant="secondary" className="text-xs">
              Active
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Life Total and Poison */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className={`h-5 w-5 ${player.life <= 5 ? 'text-red-500 animate-pulse' : 'text-red-500'}`} />
            <span className="text-2xl font-mono font-bold">{player.life}</span>
            <span className="text-sm text-muted-foreground">life</span>
          </div>

          {player.poisonCounters > 0 && (
            <Badge variant="destructive" className="text-xs">
              ☠️ {player.poisonCounters} poison
            </Badge>
          )}
        </div>

        {/* Mana Pool */}
        <div>
          <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
            <Droplet className="h-3 w-3" />
            Mana Pool
          </div>
          {totalMana > 0 ? (
            <div className="flex flex-wrap gap-1">
              {availableMana.map(({ color, count, symbol, colorClass }) => (
                <div key={color} className="flex items-center gap-1">
                  <span className="text-sm">{count}x</span>
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${colorClass}`}
                    title={color}
                  >
                    {symbol}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Empty</div>
          )}
        </div>

        {/* Hand, Battlefield, Library */}
        <div className="grid grid-cols-3 gap-2">
          {/* Hand */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Hand className="h-3 w-3" />
              Hand
            </div>
            <div className="text-lg font-semibold">{handSize}</div>
            <Progress value={handProgress} className="h-1" />
          </div>

          {/* Battlefield */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Grid3X3 className="h-3 w-3" />
              Board
            </div>
            <div className="text-lg font-semibold">
              {battlefieldInfo.untapped}/{battlefieldInfo.total}
            </div>
            <div className="text-xs text-muted-foreground">
              untapped/total
            </div>
          </div>

          {/* Library */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              Library
            </div>
            <div className="text-lg font-semibold">
              {librarySize}
            </div>
            <div className="text-xs text-muted-foreground">
              cards left
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
