"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

/**
 * Issue #2418 (SLICE 1) — the "phase bar" of the single-player board.
 *
 * This is the header strip of `GameBoardContent` — it shows the turn number,
 * the active player, the AI-thinking indicator and the match mode. It is a
 * pure presentational section: it reads only the handful of values below and
 * calls back for the single navigation action (back to the menu).
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the header is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down.
 */

export interface GameHeaderProps {
  /** Short display id (first 8 chars) of the current game. */
  gameId?: string;
  /** Current turn number shown next to the game id. */
  turnNumber: number;
  /** Name of the player whose turn it is (undefined before the game loads). */
  currentPlayerName?: string;
  /** Whether the AI opponent is currently "thinking". */
  isAIThinking: boolean;
  /** Match mode: against the AI or self-play. */
  mode: "ai" | "self-play";
  /** AI difficulty label, rendered verbatim next to the mode badge. */
  difficulty: string;
  /** Navigates back to the single-player menu. */
  onBack: () => void;
}

export const GameHeader = memo(function GameHeader({
  gameId,
  turnNumber,
  currentPlayerName,
  isAIThinking,
  mode,
  difficulty,
  onBack,
}: GameHeaderProps) {
  return (
    <header
      className="shrink-0 bg-background/95 backdrop-blur border-b"
      data-tutorial="phase-info"
    >
      <div className="flex items-center justify-between px-2 py-1.5 md:px-4 md:py-2">
        <div className="flex items-center gap-2 md:gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-11 w-11 p-0 md:h-8 md:w-8"
            onClick={onBack}
            aria-label="Back to single player menu"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="font-headline text-sm font-bold leading-tight">
              Single Player
            </h1>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground leading-none">
              <Badge
                variant="outline"
                className="text-[9px] h-3.5 px-1 py-0 font-normal"
              >
                Game {gameId?.substring(0, 8)}
              </Badge>
              <span>Turn {turnNumber}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs font-medium flex items-center gap-2">
              {currentPlayerName}
              {isAIThinking && (
                <Badge
                  variant="secondary"
                  className="animate-pulse text-[9px] h-3.5 px-1 py-0"
                >
                  AI Thinking...
                </Badge>
              )}
            </div>
          </div>
          <Badge
            variant={mode === "ai" ? "default" : "secondary"}
            className="text-[10px] h-4 px-1.5 py-0 font-normal"
          >
            {mode === "ai" ? `vs AI (${difficulty})` : "Self Play"}
          </Badge>
        </div>
      </div>
    </header>
  );
});
