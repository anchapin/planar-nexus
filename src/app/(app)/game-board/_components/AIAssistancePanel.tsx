"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertTriangle, Lightbulb, Zap } from "lucide-react";

/**
 * Types for AI analysis results
 */
export interface SuggestedPlay {
  cardName: string;
  reasoning: string;
  priority: "high" | "medium" | "low";
}

export interface Warning {
  message: string;
  type: "danger" | "warning" | "caution" | "info";
  relatedCards?: string[];
}

export interface ManaSuggestion {
  action: string;
  reasoning: string;
}

export interface AIAnalysis {
  suggestedPlays?: SuggestedPlay[];
  warnings?: Warning[];
  strategicAdvice?: string[];
}

export interface AIManaAdvice {
  suggestions?: ManaSuggestion[];
}

export interface AIBoardEval {
  playerWinChance?: number;
  boardAdvantage?: string;
}

export interface AIAssistancePanelProps {
  aiAnalysis: AIAnalysis | null;
  aiManaAdvice: AIManaAdvice | null;
  aiBoardEval: AIBoardEval | null;
}

/**
 * Floating AI assistance panel (issue #2946).
 *
 * Extracted verbatim from the game-board page so the panel — together with
 * the icons it needs — can be loaded on demand. The panel is only rendered
 * once the player enables AI assistance *and* an analysis is available, so it
 * never has to be part of this route's first-load payload. The markup is
 * unchanged: the panel renders exactly as it did inline on the page.
 */
export function AIAssistancePanel({
  aiAnalysis,
  aiManaAdvice,
  aiBoardEval,
}: AIAssistancePanelProps) {
  return (
    <Card
      className="absolute top-4 left-4 w-72 max-h-[60vh] overflow-y-auto z-10 shadow-lg bg-card/95"
      role="complementary"
      aria-label="AI Game Suggestions"
      aria-live="polite"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-yellow-500" />
          AI Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {/* Board Evaluation */}
        {aiBoardEval && (
          <div className="p-2 rounded bg-muted">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold">Win Chance:</span>
              <span
                className={cn(
                  "font-bold",
                  (aiBoardEval.playerWinChance ?? 0) >= 60
                    ? "text-green-500"
                    : (aiBoardEval.playerWinChance ?? 0) >= 40
                      ? "text-yellow-500"
                      : "text-red-500",
                )}
              >
                {aiBoardEval.playerWinChance ?? 0}%
              </span>
            </div>
            <div className="text-muted-foreground">
              Board: {aiBoardEval.boardAdvantage?.replace("_", " ")}
            </div>
          </div>
        )}

        {/* Suggested Plays */}
        {aiAnalysis?.suggestedPlays && aiAnalysis.suggestedPlays.length > 0 && (
          <div>
            <div className="font-semibold mb-1 flex items-center gap-1">
              <Zap className="h-3 w-3" /> Suggested Plays:
            </div>
            {aiAnalysis.suggestedPlays.slice(0, 3).map((play, idx) => (
              <div
                key={idx}
                className={cn(
                  "p-2 rounded mb-1",
                  play.priority === "high"
                    ? "bg-green-50 border-l-2 border-green-500"
                    : play.priority === "medium"
                      ? "bg-yellow-50 border-l-2 border-yellow-500"
                      : "bg-gray-50",
                )}
              >
                <div className="font-medium">{play.cardName}</div>
                <div className="text-muted-foreground text-[10px]">
                  {play.reasoning}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Warnings */}
        {aiAnalysis?.warnings && aiAnalysis.warnings.length > 0 && (
          <div>
            <div className="font-semibold mb-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-amber-500" />{" "}
              Warnings:
            </div>
            {aiAnalysis.warnings.slice(0, 2).map((warning, idx) => (
              <div
                key={idx}
                className={cn(
                  "p-2 rounded mb-1 text-[10px]",
                  warning.type === "danger"
                    ? "bg-red-50 text-red-700"
                    : "bg-amber-50 text-amber-700",
                )}
              >
                {warning.message}
              </div>
            ))}
          </div>
        )}

        {/* Mana Advice */}
        {aiManaAdvice?.suggestions && aiManaAdvice.suggestions.length > 0 && (
          <div>
            <div className="font-semibold mb-1">Mana Usage:</div>
            {aiManaAdvice.suggestions.slice(0, 2).map((suggestion, idx) => (
              <div key={idx} className="p-2 rounded bg-blue-50 mb-1">
                <div className="font-medium">{suggestion.action}</div>
                <div className="text-muted-foreground text-[10px]">
                  {suggestion.reasoning}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Strategic Advice */}
        {aiAnalysis?.strategicAdvice &&
          aiAnalysis.strategicAdvice.length > 0 && (
            <div className="pt-2 border-t">
              <div className="font-semibold mb-1">Strategic Advice:</div>
              {aiAnalysis.strategicAdvice
                .slice(0, 2)
                .map((advice: string, idx: number) => (
                  <div
                    key={idx}
                    className="text-muted-foreground text-[10px] mb-1"
                  >
                    • {advice}
                  </div>
                ))}
            </div>
          )}
      </CardContent>
    </Card>
  );
}

export default AIAssistancePanel;
