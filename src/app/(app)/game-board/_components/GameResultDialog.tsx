"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy } from "lucide-react";
import type { GameResult } from "@/lib/game-history";

export interface GameResultSummary {
  result: GameResult;
  life: number;
  turns: number;
}

export interface GameResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameResult: GameResultSummary | null;
}

/**
 * Game-over result dialog (issue #2946).
 *
 * Extracted verbatim from the game-board page so the dialog — together with
 * the Radix dialog primitives it pulls in — can be loaded on demand. The
 * dialog only appears once the game is over, so it never has to be part of
 * this route's first-load payload. The markup is unchanged: the dialog
 * renders exactly as it did inline on the page.
 */
export function GameResultDialog({
  open,
  onOpenChange,
  gameResult,
}: GameResultDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy
              className={`h-6 w-6 ${gameResult?.result === "win" ? "text-yellow-500" : "text-gray-500"}`}
            />
            {gameResult?.result === "win"
              ? "Victory!"
              : gameResult?.result === "loss"
                ? "Defeat"
                : "Draw"}
          </DialogTitle>
          <DialogDescription>
            Game completed after {gameResult?.turns} turns
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid gap-4 grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-3xl font-bold">{gameResult?.life}</div>
                  <div className="text-sm text-muted-foreground">Your Life</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-3xl font-bold">{gameResult?.turns}</div>
                  <div className="text-sm text-muted-foreground">Turns</div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => (window.location.href = "/single-player")}
            >
              Play Again
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => (window.location.href = "/game-history")}
            >
              View History
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default GameResultDialog;
