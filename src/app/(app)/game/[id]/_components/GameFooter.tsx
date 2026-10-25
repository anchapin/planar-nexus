"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Heart,
  Clock,
  Info,
  RotateCcw,
  Play,
  Pause,
  SkipForward,
  Flag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getTotalMana, type ManaPool } from "@/lib/game-state";

/**
 * Issue #2418 (SLICE 2) — the "game controls footer" of the single-player board.
 *
 * This is the bottom strip of `GameBoardContent`: it shows the life totals of
 * both players, the local player's mana pool and the turn/phase/action
 * buttons (pass priority, end turn, advance phase, concede, auto-save toggle
 * and the game-state info toast).
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the footer is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the handful of
 * primitives and stable callbacks the footer actually reads.
 */

export interface GameFooterProps {
  /** Name of the local (human) player. */
  playerName: string;
  /** Life total of the local player, `undefined` when the player is unknown. */
  playerLifeTotal?: number;
  /** Name of the opponent, `undefined` when there is no opponent. */
  opponentName?: string;
  /** Life total of the opponent, `undefined` when there is no opponent. */
  opponentLifeTotal?: number;
  /** Mana pool of the local player (used for the mana badges). */
  manaPool?: ManaPool;
  /** Current phase, rendered verbatim (underscores replaced by spaces). */
  currentPhase: string;
  /** Current turn number (shown in the game-state toast). */
  turnNumber: number;
  /** Raw game status, shown in the game-state toast. */
  status: string;
  /** Match mode: against the AI or self-play. */
  mode: "ai" | "self-play";
  /** Whether it is the local player's turn. */
  isPlayerTurn: boolean;
  /** Whether the game has ended (status === "completed"). */
  isGameEnded: boolean;
  /** Whether the auto-save timer is enabled. */
  autoSaveEnabled: boolean;
  /** Whether the viewport is narrow (hides the "Game in Progress" label). */
  isMobile: boolean;
  /** Passes priority / advances to the next phase. */
  onPassPriority: () => void;
  /** Ends the current turn. */
  onEndTurn: () => void;
  /** Advances to the next phase (self-play only). */
  onAdvancePhase: () => void;
  /** Concedes the game. */
  onConcede: () => void;
  /** Toggles the auto-save timer. */
  onToggleAutoSave: () => void;
}

export const GameFooter = memo(function GameFooter({
  playerName,
  playerLifeTotal,
  opponentName,
  opponentLifeTotal,
  manaPool,
  currentPhase,
  turnNumber,
  status,
  mode,
  isPlayerTurn,
  isGameEnded,
  autoSaveEnabled,
  isMobile,
  onPassPriority,
  onEndTurn,
  onAdvancePhase,
  onConcede,
  onToggleAutoSave,
}: GameFooterProps) {
  const { toast } = useToast();

  return (
    <footer
      className="shrink-0 bg-background/95 backdrop-blur border-t p-1.5 md:p-2"
      data-tutorial="actions"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div
          className="flex items-center gap-4 text-xs text-muted-foreground"
          data-tutorial="life-total"
        >
          <span className="flex items-center gap-1">
            <Heart className="w-3 h-3" />
            {playerName}: {playerLifeTotal || 20}
          </span>
          {opponentName && (
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3" />
              {opponentName}: {opponentLifeTotal || 20}
            </span>
          )}
          {/* Mana Pool Display */}
          {(() => {
            const pool = manaPool;
            if (!pool || getTotalMana(pool) === 0) return null;
            return (
              <span className="flex items-center gap-1 ml-2 border-l pl-2 border-border">
                {pool.white > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1 bg-yellow-500/20 text-yellow-700 border-yellow-500/30"
                  >
                    {pool.white}W
                  </Badge>
                )}
                {pool.blue > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1 bg-blue-500/20 text-blue-700 border-blue-500/30"
                  >
                    {pool.blue}U
                  </Badge>
                )}
                {pool.black > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1 bg-gray-800/40 text-gray-300 border-gray-500/30"
                  >
                    {pool.black}B
                  </Badge>
                )}
                {pool.red > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1 bg-red-500/20 text-red-700 border-red-500/30"
                  >
                    {pool.red}R
                  </Badge>
                )}
                {pool.green > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1 bg-green-500/20 text-green-700 border-green-500/30"
                  >
                    {pool.green}G
                  </Badge>
                )}
                {pool.colorless > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1 bg-gray-500/20 text-gray-600 border-gray-500/30"
                  >
                    {pool.colorless}C
                  </Badge>
                )}
                {pool.generic > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1 bg-muted"
                  >
                    {pool.generic}
                  </Badge>
                )}
              </span>
            );
          })()}
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Current phase badge */}
          <Badge
            variant={isPlayerTurn ? "default" : "outline"}
            className="text-[10px] capitalize hidden sm:inline-flex"
          >
            {currentPhase.replace("_", " ")}
          </Badge>

          {/* Pass Priority — available in both modes */}
          <Button
            variant="outline"
            size="sm"
            onClick={onPassPriority}
            disabled={isGameEnded}
            className="h-11 md:h-8"
            title={
              mode === "ai"
                ? "Advance to the next phase"
                : "Pass priority to opponent"
            }
          >
            <SkipForward className="w-3 h-3 mr-1" />
            {mode === "ai" ? "Next Phase" : "Pass Priority"}
          </Button>

          {/* End Turn */}
          <Button
            variant="outline"
            size="sm"
            onClick={onEndTurn}
            disabled={isGameEnded || !isPlayerTurn}
            title="Pass through all remaining phases to end your turn"
            className="h-11 md:h-8"
          >
            <Flag className="w-3 h-3 mr-1" />
            End Turn
          </Button>

          {/* Self-play-only controls */}
          {mode === "self-play" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onAdvancePhase}
              disabled={isGameEnded}
              className="h-11 md:h-8"
            >
              <Play className="w-3 h-3 mr-1" />
              Advance Phase
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={onConcede}
            disabled={isGameEnded}
            className="h-11 md:h-8"
          >
            Concede
          </Button>

          <Button
            variant={autoSaveEnabled ? "default" : "outline"}
            size="sm"
            onClick={onToggleAutoSave}
            title={autoSaveEnabled ? "Auto-save enabled" : "Auto-save disabled"}
            className="h-11 w-11 p-0 md:h-8 md:w-auto md:p-0"
          >
            {autoSaveEnabled ? (
              <RotateCcw className="w-3 h-3" />
            ) : (
              <Pause className="w-3 h-3" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              toast({
                title: "Game State",
                description: `Turn ${turnNumber}, Phase: ${currentPhase}, Status: ${status}`,
              });
            }}
            className="h-11 w-11 p-0 md:h-8 md:w-auto md:p-0"
          >
            <Info className="w-3 h-3" />
          </Button>
        </div>

        {!isMobile && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>
              {status === "completed" ? "Game Ended" : "Game in Progress"}
            </span>
          </div>
        )}
      </div>
    </footer>
  );
});
