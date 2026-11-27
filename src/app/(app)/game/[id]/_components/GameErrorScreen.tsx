"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft } from "lucide-react";

/**
 * Issue #2418 (SLICE 12) — the error / "game not found" screen of the
 * single-player board.
 *
 * `GameBoardContent` used to inline this screen in one of its two early
 * returns. It is extracted here as a `React.memo`-wrapped leaf that receives
 * only narrow props: the error message (a plain string, `null` when the game
 * simply was not found) and a stable `onBack` callback.
 *
 * The rendered output is byte-for-byte the same JSX that used to live inline
 * in `GameBoardContent`: the same "Back" ghost button, the same destructive
 * alert (falling back to "Game not found") and the same "Return to Menu"
 * button, all navigating to "/single-player".
 */

export interface GameErrorScreenProps {
  /** Error message to display, or `null` when the game was not found. */
  message?: string | null;
  /** Navigates back to the single-player menu. */
  onBack: () => void;
}

export const GameErrorScreen = memo(function GameErrorScreen({
  message,
  onBack,
}: GameErrorScreenProps) {
  return (
    <div className="flex-1 p-2 md:p-4">
      <Button variant="ghost" onClick={onBack} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back
      </Button>
      <Card className="max-w-md mx-auto">
        <CardContent className="p-6">
          <Alert variant="destructive">
            <AlertDescription>{message || "Game not found"}</AlertDescription>
          </Alert>
          <Button onClick={onBack} className="mt-4 w-full">
            Return to Menu
          </Button>
        </CardContent>
      </Card>
    </div>
  );
});
