"use client";

import { memo } from "react";
import type { ComponentProps, ContextType } from "react";
import { GameBoard } from "@/components/game-board";
import { TargetHighlightContext } from "@/components/target-highlight-context";
import { GameBoardErrorBoundary } from "@/components/error-boundaries";

/**
 * Issue #2418 (SLICE 10) — the "game board" region of the single-player board.
 *
 * This is the battlefield of `GameBoardContent`: the `<main>` element that
 * hosts the error boundary, the legal-target provider and the `GameBoard`
 * itself. It is extracted into a `React.memo`-wrapped leaf so a delta that
 * only touches the header or the footer no longer re-renders the board.
 *
 * The props are taken straight from the existing `GameBoard` props (via
 * `ComponentProps<typeof GameBoard>`) and from the existing target-highlight
 * context value type — no new domain types are introduced here. The rendered
 * output is byte-for-byte the same JSX that used to live inline in
 * `GameBoardContent`.
 */

/** The prop types of the real `GameBoard` (reused, never re-declared). */
type GameBoardProps = ComponentProps<typeof GameBoard>;

export interface GameBoardRegionProps {
  /** The players as rendered by the board (local player sorted last). */
  players: GameBoardProps["players"];
  /** Number of players in the game (2, 3 or 4). */
  playerCount: GameBoardProps["playerCount"];
  /** Index of the player whose turn it is. */
  currentTurnIndex: GameBoardProps["currentTurnIndex"];
  /** Handles a card click on the board. */
  onCardClick?: GameBoardProps["onCardClick"];
  /** Handles a zone click on the board. */
  onZoneClick?: GameBoardProps["onZoneClick"];
  /** Concedes the game. */
  onConcede?: GameBoardProps["onConcede"];
  /** Offers a draw. */
  onOfferDraw?: GameBoardProps["onOfferDraw"];
  /** Accepts a draw offer. */
  onAcceptDraw?: GameBoardProps["onAcceptDraw"];
  /** Declines a draw offer. */
  onDeclineDraw?: GameBoardProps["onDeclineDraw"];
  /** Ids that are legal targets right now (value of the target context). */
  legalTargetIds: ContextType<typeof TargetHighlightContext>;
}

export const GameBoardRegion = memo(function GameBoardRegion({
  players,
  playerCount,
  currentTurnIndex,
  onCardClick,
  onZoneClick,
  onConcede,
  onOfferDraw,
  onAcceptDraw,
  onDeclineDraw,
  legalTargetIds,
}: GameBoardRegionProps) {
  return (
    <main className="flex-1 min-h-0 overflow-hidden" data-tutorial="battlefield">
      <div className="h-full w-full">
        <GameBoardErrorBoundary>
          <TargetHighlightContext.Provider value={legalTargetIds}>
            <GameBoard
              players={players}
              playerCount={playerCount}
              currentTurnIndex={currentTurnIndex}
              onCardClick={onCardClick}
              onZoneClick={onZoneClick}
              onConcede={onConcede}
              onOfferDraw={onOfferDraw}
              onAcceptDraw={onAcceptDraw}
              onDeclineDraw={onDeclineDraw}
            />
          </TargetHighlightContext.Provider>
        </GameBoardErrorBoundary>
      </div>
    </main>
  );
});
