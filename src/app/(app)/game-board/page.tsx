"use client";

import * as React from "react";
import { useState, useTransition, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { GameBoard } from "@/components/game-board";
import { GameChat } from "@/components/game-chat";
import { EmotePicker, EmoteFeed } from "@/components/emote-picker";
import { TurnTimer } from "@/components/turn-timer";
import { DamageOverlay, useDamageEvents } from "@/components/damage-indicator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlayerCount, ZoneType } from "@/types/game";
import {
  Swords,
  Eye,
  MessageCircle,
  Smile,
  Lightbulb,
  AlertTriangle,
  Zap,
  Trophy,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGameChat } from "@/hooks/use-game-chat";
import { useGameEmotes } from "@/hooks/use-game-emotes";
import { cn } from "@/lib/utils";
import {
  analyzeCurrentGameState,
  getManaAdvice,
  evaluateBoardState,
} from "@/ai/flows/ai-gameplay-assistance";
import { useGameEngine } from "@/hooks/use-game-engine";
import { useAIWorker } from "@/hooks/use-ai-worker";
import { AIThinkingIndicator } from "@/components/ai/AIThinkingIndicator";
import type {
  CardInstanceId,
  GameAction,
  ActionType,
} from "@/lib/game-state/types";
import {
  saveGameRecord,
  createGameRecord,
  type GameMode,
  type GameResult,
} from "@/lib/game-history";
import {
  XValueChoiceDialog,
  ModeChoiceDialog,
} from "@/components/choice-dialog";
import { useAchievementTracking } from "@/hooks/use-achievement-tracking";
import { evaluateGameState, quickScore } from "@/ai/game-state-evaluator";
import { summarizeGame } from "@/lib/game-summarizer";
import { engineToAIState } from "@/lib/game-state/serialization";

// Type definitions for AI analysis results
interface SuggestedPlay {
  cardName: string;
  reasoning: string;
  priority: "high" | "medium" | "low";
}

interface Warning {
  message: string;
  type: "danger" | "warning" | "caution" | "info";
  relatedCards?: string[];
}

interface ManaSuggestion {
  action: string;
  reasoning: string;
}

interface AIAnalysis {
  suggestedPlays?: SuggestedPlay[];
  warnings?: Warning[];
  strategicAdvice?: string[];
}

interface AIManaAdvice {
  suggestions?: ManaSuggestion[];
}

interface AIBoardEval {
  playerWinChance?: number;
  boardAdvantage?: string;
}

export default function GameBoardPage() {
  const [playerCount, setPlayerCount] = React.useState<PlayerCount>(2);
  const [timerEnabled, setTimerEnabled] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(true);
  const [aiAssistanceEnabled, setAiAssistanceEnabled] = React.useState(false);
  const [isAnalyzing, startAnalysis] = useTransition();
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiManaAdvice, setAiManaAdvice] = useState<AIManaAdvice | null>(null);
  const [aiBoardEval, setAiBoardEval] = useState<AIBoardEval | null>(null);
  const [showGameResult, setShowGameResult] = useState(false);
  const [gameResult, setGameResult] = useState<{
    result: GameResult;
    life: number;
    turns: number;
  } | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>("self_play");
  const [difficulty, setDifficulty] = useState("medium");
  const [aiTheme, setAiTheme] = useState("aggressive");
  const [actions, setActions] = useState<GameAction[]>([]);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [showXValueDialog, setShowXValueDialog] = useState(false);
  const [xValueChoiceData, setXValueChoiceData] = useState<{
    prompt: string;
    sourceCardName: string;
    minX: number;
    maxX: number;
    stackObjectId: string;
  } | null>(null);
  const [showModeDialog, setShowModeDialog] = useState(false);
  const [modeChoiceData, setModeChoiceData] = useState<{
    prompt: string;
    sourceCardName: string;
    modes: Array<{ label: string; value: string | number; isValid: boolean }>;
    minChoices: number;
    maxChoices: number;
    stackObjectId: string;
  } | null>(null);
  const { toast } = useToast();
  // Use player-2 as default for achievement tracking since this is a self-play game
  const { onGameEnd, trackCollectionAchievements } =
    useAchievementTracking("player-2");

  const {
    isThinking: isAIWorkerThinking,
    analyzeState: analyzeStateViaWorker,
  } = useAIWorker();

  // Get game mode from URL params on client side
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") as GameMode;
    if (mode) setGameMode(mode);
    const diff = params.get("difficulty");
    if (diff) setDifficulty(diff);
    const theme = params.get("theme");
    if (theme) setAiTheme(theme);
  }, []);

  // Initialize game engine with 2 players
  const {
    gameState,
    engineState,
    isGameStarted,
    currentPlayerId,
    initializeGame,
    startGame,
    advancePhase: engineAdvancePhase,
    nextTurn: engineNextTurn,
    passPriority: enginePassPriority,
    playLand: enginePlayLand,
    tapCard: engineTapCard,
    untapCard: engineUntapCard,
    damagePlayer: engineDamagePlayer,
    canPlayLand,
    resolveWaitingChoice,
  } = useGameEngine({
    playerNames: ["Opponent", "You"],
    startingLife: 20,
    isCommander: false,
    autoStart: true,
  });

  // Track an action and check for mistakes
  const trackAction = React.useCallback(
    async (type: ActionType, data: any) => {
      if (!engineState || !currentPlayerId) return;

      const action: GameAction = {
        type,
        playerId: currentPlayerId,
        timestamp: Date.now(),
        data,
      };

      setActions((prev) => [...prev, action]);

      // Mistake detection: evaluate current state after action
      // Convert engine state to AI format for evaluation
      const aiState = engineToAIState(engineState);

      try {
        // Offload heuristic evaluation to Web Worker
        const evaluation = await analyzeStateViaWorker({
          gameState: aiState,
          playerId: currentPlayerId,
          difficulty: "hard",
        });

        if (evaluation) {
          // If the evaluation shows a poor position, flag it as a potential mistake
          // A low total score relative to turn number suggests mistakes were made
          const turnsPlayed = engineState.turn.turnNumber;
          const expectedScore = turnsPlayed * 5; // Rough heuristic
          if (evaluation.totalScore < expectedScore - 10) {
            const mistakeMsg = `Potential mistake detected: ${type}. Score: ${evaluation.totalScore}. Recommendation: ${evaluation.recommendedActions[0] || "Consider re-evaluating your strategy."}`;
            setMistakes((prev) => [...prev, mistakeMsg]);
          }
        }
      } catch (err) {
        console.error("AI mistake detection failed:", err);
      }
    },
    [engineState, currentPlayerId, analyzeStateViaWorker],
  );

  // Wrapped engine actions
  const advancePhase = () => {
    trackAction("pass_priority", { reason: "advance_phase" });
    engineAdvancePhase();
  };

  const nextTurn = () => {
    trackAction("pass_priority", { reason: "next_turn" });
    engineNextTurn();
  };

  const passPriority = () => {
    trackAction("pass_priority", {});
    enginePassPriority();
  };

  const playLand = (cardId: CardInstanceId) => {
    trackAction("play_land", { cardId });
    return enginePlayLand(cardId);
  };

  const tapCard = (cardId: CardInstanceId) => {
    trackAction("tap_card", { cardId });
    engineTapCard(cardId);
  };

  const untapCard = (cardId: CardInstanceId) => {
    trackAction("untap_card", { cardId });
    engineUntapCard(cardId);
  };

  const damagePlayer = (playerId: string, amount: number) => {
    trackAction("deal_damage", { targetId: playerId, amount });
    engineDamagePlayer(playerId, amount);
  };

  // Initialize game on mount
  useEffect(() => {
    initializeGame();
    startGame();
  }, []);

  // Handle X value choices (variable mana cost spells)
  useEffect(() => {
    if (!engineState?.waitingChoice) {
      return;
    }

    const choice = engineState.waitingChoice;
    if (choice.type !== "choose_value") {
      return;
    }

    // Extract min and max X from choices
    const values = choice.choices
      .filter((c: any) => c.isValid)
      .map((c: any) => c.value as number);

    const minX = values.length > 0 ? Math.min(...values) : 0;
    const maxX = values.length > 0 ? Math.max(...values) : 0;

    // Get source card name from stack object
    let sourceCardName = "Card";
    if (choice.stackObjectId) {
      const stackObj = engineState.stack.find(
        (s) => s.id === choice.stackObjectId,
      );
      if (stackObj?.sourceCardId) {
        const sourceCard = engineState.cards.get(stackObj.sourceCardId);
        if (sourceCard) {
          sourceCardName = sourceCard.cardData.name;
        }
      }
    }

    setXValueChoiceData({
      prompt: choice.prompt,
      sourceCardName,
      minX,
      maxX,
      stackObjectId: choice.stackObjectId || "",
    });
    setShowXValueDialog(true);
  }, [engineState?.waitingChoice]);

  // Handle mode choices (modal spells)
  useEffect(() => {
    if (!engineState?.waitingChoice) {
      return;
    }

    const choice = engineState.waitingChoice;
    if (choice.type !== "choose_mode") {
      return;
    }

    // Get source card name from stack object
    let sourceCardName = "Card";
    if (choice.stackObjectId) {
      const stackObj = engineState.stack.find(
        (s) => s.id === choice.stackObjectId,
      );
      if (stackObj?.sourceCardId) {
        const sourceCard = engineState.cards.get(stackObj.sourceCardId);
        if (sourceCard) {
          sourceCardName = sourceCard.cardData.name;
        }
      }
    }

    setModeChoiceData({
      prompt: choice.prompt,
      sourceCardName,
      modes: choice.choices.map((c: any) => ({
        label: c.label,
        value: c.value,
        isValid: c.isValid,
      })),
      minChoices: choice.minChoices,
      maxChoices: choice.maxChoices,
      stackObjectId: choice.stackObjectId || "",
    });
    setShowModeDialog(true);
  }, [engineState?.waitingChoice]);

  // Get current player info from engine
  const currentPlayer = gameState?.players.find(
    (p) => p.id === currentPlayerId,
  );
  const currentPlayerName = currentPlayer?.name || "You";

  // Initialize chat
  const {
    messages: aiMessages,
    legacyMessages: messages,
    sendMessage,
    clearMessages,
    unreadCount,
    markAsRead,
  } = useGameChat({
    currentPlayerId: currentPlayerId || "player-2",
    currentPlayerName,
  });

  // Initialize emotes
  const { emotes, sendEmote, clearEmotes } = useGameEmotes({
    currentPlayerId: currentPlayerId || "player-2",
    currentPlayerName,
  });

  // Initialize damage events
  const { events: damageEvents, addDamage, addHeal } = useDamageEvents();

  // Handle chat open/close
  React.useEffect(() => {
    if (chatOpen) {
      markAsRead();
    }
  }, [chatOpen, messages.length, markAsRead]);

  const handleCardClick = (cardId: string, zone: ZoneType) => {
    // Tap/untap creature on battlefield
    if (zone === "battlefield") {
      const card = engineState?.cards.get(cardId);
      if (card?.cardData.type_line.includes("Creature")) {
        if (card.isTapped) {
          untapCard(cardId);
          toast({
            title: "Untapped",
            description: `${card.cardData.name} is now untapped`,
          });
        } else {
          tapCard(cardId);
          toast({
            title: "Tapped",
            description: `${card.cardData.name} is now tapped`,
          });
        }
      }
    }

    toast({
      title: "Card Selected",
      description: `Clicked ${cardId} in ${zone}`,
    });
  };

  const handleZoneClick = (zone: ZoneType, playerId: string) => {
    if (!gameState) return;

    const player = gameState.players.find((p) => p.id === playerId);
    let zoneData: unknown[] = [];

    if (!player) return;

    // Map ZoneType to PlayerState properties
    switch (zone) {
      case "commandZone":
        zoneData = player.commandZone || [];
        break;
      case "battlefield":
        zoneData = player.battlefield || [];
        break;
      case "hand":
        zoneData = player.hand || [];
        break;
      case "graveyard":
        zoneData = player.graveyard || [];
        break;
      case "exile":
        zoneData = player.exile || [];
        break;
      case "library":
        zoneData = player.library || [];
        break;
      case "stack":
      case "sideboard":
      case "anticipate":
        zoneData = [];
        break;
    }

    toast({
      title: `${zone.charAt(0).toUpperCase() + zone.slice(1)} Zone`,
      description: `${player.name}'s ${zone}: ${zoneData.length || 0} cards`,
    });
  };

  const handleDamagePlayer = (playerId: string, amount: number) => {
    damagePlayer(playerId, amount);
    addDamage(amount, "combat", playerId);
  };

  const handleHealPlayer = (playerId: string, amount: number) => {
    // For now, just show toast - heal would need to be implemented in engine
    toast({
      title: "Heal",
      description: `Would heal ${amount} to ${playerId}`,
    });
    addHeal(amount, playerId);
  };

  // Handle AI assistance request
  const handleAIAssistance = () => {
    if (!currentPlayer || !gameState || !engineState) return;

    const analysisState = engineToAIState(engineState);

    startAnalysis(async () => {
      try {
        const analysis = await analyzeCurrentGameState({
          gameState: analysisState,
          playerName: currentPlayerName,
        });
        setAiAnalysis(analysis);

        const mana = await getManaAdvice({
          gameState: analysisState,
          playerName: currentPlayerName,
        });
        setAiManaAdvice(mana);

        const boardEval = await evaluateBoardState({
          gameState: analysisState,
          playerName: currentPlayerName,
        });
        setAiBoardEval(boardEval);

        toast({
          title: "AI Analysis Complete",
          description: "Your game has been analyzed for suggestions.",
        });
      } catch (error) {
        console.error("AI analysis error:", error);
        toast({
          variant: "destructive",
          title: "Analysis Failed",
          description: "Could not get AI assistance. Please try again.",
        });
      }
    });
  };

  // Track game result when game ends
  const trackGameResult = (result: GameResult) => {
    if (!gameState) return;

    const player = gameState.players.find((p) => p.id === currentPlayerId);
    const opponent = gameState.players.find((p) => p.id !== currentPlayerId);

    const playerDeck = "Selected Deck"; // Would get from actual deck selection

    // Generate AI summary of the game
    const summary = summarizeGame(actions, result, playerDeck);

    const record = createGameRecord({
      mode: gameMode,
      result,
      playerDeck,
      opponentDeck: gameMode === "vs_ai" ? `AI (${aiTheme})` : undefined,
      difficulty: gameMode === "vs_ai" ? difficulty : undefined,
      turns: gameState.turnNumber,
      playerLifeAtEnd: player?.lifeTotal || 0,
      opponentLifeAtEnd: opponent?.lifeTotal || 0,
      mulligans: 0, // Would track from actual game
      actions,
      mistakes,
      summary,
    });

    saveGameRecord(record).catch(console.error);

    // Track achievements for this game
    onGameEnd({ gameState, won: result === "win" });

    setGameResult({
      result,
      life: player?.lifeTotal || 0,
      turns: gameState.turnNumber,
    });
    setShowGameResult(true);

    toast({
      title:
        result === "win" ? "Victory!" : result === "loss" ? "Defeat" : "Draw",
      description: `Game saved to history after ${gameState.turnNumber} turns`,
    });
  };

  // Check for game end conditions
  useEffect(() => {
    if (!gameState || !isGameStarted) return;

    // Check if any player has 0 or less life
    const losingPlayer = gameState.players.find((p) => p.lifeTotal <= 0);
    if (losingPlayer) {
      const winner = gameState.players.find((p) => p.id !== losingPlayer.id);
      if (winner?.id === currentPlayerId) {
        trackGameResult("win");
      } else if (gameMode === "self_play") {
        // In self-play, player controls both sides
        trackGameResult("win");
      } else {
        trackGameResult("loss");
      }
    }
  }, [gameState?.players.map((p) => p.lifeTotal).join(","), isGameStarted]);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar for controls */}
      <div className="w-80 border-r border-border/50 bg-card/50 p-4 overflow-y-auto">
        <div className="space-y-6">
          <div>
            <h1 className="font-headline text-2xl font-bold flex items-center gap-2">
              <Swords className="h-6 w-6" />
              Game Board
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isGameStarted ? "Game in Progress" : "Not Started"}
            </p>
          </div>

          {/* Redirect banner to new single-player experience */}
          <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
            <p className="text-xs text-primary font-medium flex items-start gap-2">
              <Sparkles className="h-4 w-4 shrink-0" />
              <span>
                Looking for a better experience? Try the new Single Player mode
                with deck selection, mulligans, and a guided tutorial.
              </span>
            </p>
            <Button
              variant="link"
              size="sm"
              className="h-6 px-0 text-xs mt-1"
              onClick={() => (window.location.href = "/single-player")}
            >
              Go to Single Player <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>

          <Separator />

          {/* Configuration */}
          <div className="space-y-4">
            <h2 className="font-semibold text-sm">Game Controls</h2>

            <div className="space-y-2">
              <Label htmlFor="player-count">Player Count</Label>
              <Select
                value={playerCount.toString()}
                onValueChange={(value) =>
                  setPlayerCount(Number(value) as PlayerCount)
                }
                disabled={isGameStarted}
              >
                <SelectTrigger id="player-count">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 Players (1v1)</SelectItem>
                  <SelectItem value="4">4 Players (Commander)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={nextTurn} className="w-full" variant="default">
              Next Turn
            </Button>

            <Button onClick={advancePhase} className="w-full" variant="outline">
              Advance Phase
            </Button>

            <Button
              onClick={passPriority}
              className="w-full"
              variant="ghost"
              size="sm"
            >
              Pass Priority
            </Button>
          </div>

          <Separator />

          {/* Player Life Totals */}
          <div className="space-y-4">
            <h2 className="font-semibold text-sm">Players</h2>

            {gameState?.players.map((player, idx) => (
              <Card
                key={player.id}
                className={
                  player.id === currentPlayerId ? "border-primary/50" : ""
                }
                role="region"
                aria-labelledby={`player-${player.id}-label`}
              >
                <CardHeader className="pb-2">
                  <CardTitle
                    className="text-sm flex items-center justify-between"
                    id={`player-${player.id}-label`}
                  >
                    {player.name}
                    {player.isCurrentTurn && (
                      <span className="text-xs text-primary animate-pulse">
                        Active
                      </span>
                    )}
                    {player.hasPriority && (
                      <span className="text-xs text-green-500">Priority</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span
                      className="text-2xl font-mono font-bold"
                      aria-label={`${player.name} has ${player.lifeTotal} life`}
                    >
                      {player.lifeTotal}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDamagePlayer(player.id, 1)}
                        aria-label={`Deal 1 damage to ${player.name}`}
                      >
                        -1
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleHealPlayer(player.id, 1)}
                        aria-label={`Heal 1 life to ${player.name}`}
                      >
                        +1
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleDamagePlayer(player.id, 5)}
                      aria-label={`Deal 5 damage to ${player.name}`}
                    >
                      -5
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleHealPlayer(player.id, 5)}
                      aria-label={`Heal 5 life to ${player.name}`}
                    >
                      +5
                    </Button>
                  </div>
                  {player.poisonCounters > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Poison: {player.poisonCounters}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Timer Toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="timer-toggle" className="text-sm">
              Turn Timer
            </Label>
            <input
              type="checkbox"
              id="timer-toggle"
              checked={timerEnabled}
              onChange={(e) => setTimerEnabled(e.target.checked)}
              className="toggle"
              aria-checked={timerEnabled}
              aria-label="Enable turn timer"
            />
          </div>

          {timerEnabled && (
            <TurnTimer
              totalSeconds={120}
              autoStart={true}
              isCurrentPlayer={true}
              showControls={true}
              className="w-full"
            />
          )}

          <Separator />

          {/* AI Assistance Toggle */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              AI Assistance
            </h2>
            <div className="flex items-center justify-between">
              <Label htmlFor="ai-toggle" className="text-xs">
                Enable AI Hints
              </Label>
              <input
                type="checkbox"
                id="ai-toggle"
                checked={aiAssistanceEnabled}
                onChange={(e) => setAiAssistanceEnabled(e.target.checked)}
                className="toggle"
                aria-checked={aiAssistanceEnabled}
                aria-label="Enable AI hints"
              />
            </div>
            <Button
              onClick={handleAIAssistance}
              disabled={isAnalyzing || !aiAssistanceEnabled}
              variant="outline"
              className="w-full"
              size="sm"
              aria-pressed={aiAssistanceEnabled}
            >
              {isAnalyzing ? "Analyzing..." : "Get AI Suggestions"}
            </Button>
            {(isAnalyzing || isAIWorkerThinking) && (
              <div className="mt-2 flex justify-center">
                <AIThinkingIndicator
                  size="sm"
                  label={
                    isAnalyzing
                      ? "Genkit Analyzing..."
                      : "Heuristic Thinking..."
                  }
                />
              </div>
            )}
            {aiAssistanceEnabled && (
              <p className="text-xs text-muted-foreground">
                Get real-time hints and play recommendations during your game.
              </p>
            )}
          </div>

          {/* Emote Picker */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Smile className="h-4 w-4" />
              Emotes
            </h2>
            <EmotePicker
              onSelectEmote={sendEmote}
              disabled={!currentPlayer}
              className="w-full"
            />
            {emotes.length > 0 && (
              <EmoteFeed emotes={emotes} className="mt-2" />
            )}
          </div>

          <Separator />

          {/* Instructions */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Game Info
            </h2>
            <p className="text-xs text-muted-foreground">
              {gameState ? (
                <>
                  Turn {gameState.turnNumber} -{" "}
                  {gameState.currentPhase.replace("_", " ")}
                </>
              ) : (
                <>Initializing game...</>
              )}
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Click creatures to tap/untap</li>
              <li>Use damage controls to change life totals</li>
              <li>Advance phase or go to next turn</li>
              <li>Pass priority to move to next step</li>
            </ul>
          </div>

          <Separator />

          {/* Status */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Game Status:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Players: {gameState?.players.length || 0}</li>
              <li>Turn: {gameState?.turnNumber || 0}</li>
              <li>Phase: {gameState?.currentPhase || "N/A"}</li>
              <li>
                Priority:{" "}
                {currentPlayerId
                  ? gameState?.players.find((p) => p.id === currentPlayerId)
                      ?.name
                  : "N/A"}
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Game Board */}
      <div className="flex-1 h-full relative">
        {gameState && (
          <GameBoard
            players={gameState.players}
            playerCount={gameState.playerCount}
            currentTurnIndex={gameState.currentTurnPlayerIndex}
            onCardClick={handleCardClick}
            onZoneClick={handleZoneClick}
          />
        )}

        {/* Floating Chat Panel */}
        <div className="absolute bottom-4 right-4 w-80 z-10">
          {chatOpen ? (
            <GameChat
              messages={messages}
              currentPlayerId={currentPlayerId || "player-2"}
              currentPlayerName={currentPlayerName}
              onSendMessage={sendMessage}
              className="shadow-lg"
            />
          ) : (
            <Button
              variant="outline"
              size="icon"
              className="relative bg-card/90"
              onClick={() => setChatOpen(true)}
              aria-label={`Open chat ${unreadCount > 0 ? `(${unreadCount} unread messages)` : ""}`}
            >
              <MessageCircle className="w-4 h-4" />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center"
                  aria-hidden="true"
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          )}
        </div>

        {/* Floating Emote Feed */}
        <div className="absolute top-4 right-4 z-10">
          {emotes.length > 0 && (
            <EmoteFeed
              emotes={emotes}
              className="bg-card/90 p-2 rounded-lg shadow-lg"
            />
          )}
        </div>

        {/* Damage Indicators Overlay */}
        <DamageOverlay events={damageEvents} className="pointer-events-none" />

        {/* Floating AI Assistance Panel */}
        {(aiAnalysis || aiManaAdvice || aiBoardEval) && aiAssistanceEnabled && (
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
              {aiAnalysis?.suggestedPlays &&
                aiAnalysis.suggestedPlays.length > 0 && (
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
              {aiManaAdvice?.suggestions &&
                aiManaAdvice.suggestions.length > 0 && (
                  <div>
                    <div className="font-semibold mb-1">Mana Usage:</div>
                    {aiManaAdvice.suggestions
                      .slice(0, 2)
                      .map((suggestion, idx) => (
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
        )}
      </div>

      {/* Game Result Dialog */}
      <Dialog open={showGameResult} onOpenChange={setShowGameResult}>
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
                    <div className="text-sm text-muted-foreground">
                      Your Life
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <div className="text-3xl font-bold">
                      {gameResult?.turns}
                    </div>
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

      {/* X Value Choice Dialog for variable mana cost spells */}
      {xValueChoiceData && (
        <XValueChoiceDialog
          open={showXValueDialog}
          onOpenChange={(open) => {
            setShowXValueDialog(open);
            if (!open) {
              setXValueChoiceData(null);
            }
          }}
          prompt={xValueChoiceData.prompt}
          sourceCardName={xValueChoiceData.sourceCardName}
          minX={xValueChoiceData.minX}
          maxX={xValueChoiceData.maxX}
          onSelect={() => {}}
          onConfirm={(value) => {
            resolveWaitingChoice(value);
            setShowXValueDialog(false);
            setXValueChoiceData(null);
          }}
          onCancel={() => {
            setShowXValueDialog(false);
            setXValueChoiceData(null);
          }}
        />
      )}

      {/* Mode Choice Dialog for modal spells */}
      {modeChoiceData && (
        <ModeChoiceDialog
          open={showModeDialog}
          onOpenChange={(open) => {
            setShowModeDialog(open);
            if (!open) {
              setModeChoiceData(null);
            }
          }}
          prompt={modeChoiceData.prompt}
          sourceCardName={modeChoiceData.sourceCardName}
          modes={modeChoiceData.modes}
          minChoices={modeChoiceData.minChoices}
          maxChoices={modeChoiceData.maxChoices}
          onSelect={() => {}}
          onConfirm={(value) => {
            resolveWaitingChoice(value);
            setShowModeDialog(false);
            setModeChoiceData(null);
          }}
          onCancel={() => {
            setShowModeDialog(false);
            setModeChoiceData(null);
          }}
        />
      )}
    </div>
  );
}
