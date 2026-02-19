"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { GameBoard } from "@/components/game-board";
import { GameChat, ChatMessage } from "@/components/game-chat";
import { EmotePicker, EmoteFeed, EmoteMessage } from "@/components/emote-picker";
import { TurnTimer } from "@/components/turn-timer";
import { DamageOverlay, useDamageEvents, DamageType } from "@/components/damage-indicator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { PlayerState, PlayerCount, ZoneType } from "@/types/game";
import { Swords, Settings, Eye, MessageCircle, Smile, Lightbulb, AlertTriangle, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGameChat } from "@/hooks/use-game-chat";
import { useGameEmotes } from "@/hooks/use-game-emotes";
import { cn } from "@/lib/utils";
import { analyzeCurrentGameState, getManaAdvice, evaluateBoardState } from "@/ai/flows/ai-gameplay-assistance";

// Type definitions for AI analysis results
interface SuggestedPlay {
  cardName: string;
  reasoning: string;
  priority: 'high' | 'medium' | 'low';
}

interface Warning {
  message: string;
  type: 'danger' | 'warning' | 'caution' | 'info';
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

// Mock data generator for demonstration
function generateMockPlayer(
  id: string,
  name: string,
  lifeTotal: number,
  isCommander: boolean
): PlayerState {
  const battlefieldCount = Math.floor(Math.random() * 8);
  const handCount = Math.floor(Math.random() * 7) + 1;
  const graveyardCount = Math.floor(Math.random() * 15);
  const exileCount = Math.floor(Math.random() * 5);
  const libraryCount = isCommander ? 99 - 7 - 10 : 60 - 7 - 10;

  return {
    id,
    name,
    lifeTotal,
    poisonCounters: 0,
    hand: Array.from({ length: handCount }, (_, i) => ({
      id: `${id}-hand-${i}`,
      card: {
        id: `card-${i}`,
        name: `Card ${i + 1}`,
        color_identity: [],
      },
      zone: "hand" as ZoneType,
      playerId: id,
    })),
    battlefield: Array.from({ length: battlefieldCount }, (_, i) => ({
      id: `${id}-battlefield-${i}`,
      card: {
        id: `card-${i}`,
        name: `Creature ${i + 1}`,
        color_identity: [],
      },
      zone: "battlefield" as ZoneType,
      playerId: id,
      tapped: Math.random() > 0.7,
    })),
    graveyard: Array.from({ length: graveyardCount }, (_, i) => ({
      id: `${id}-graveyard-${i}`,
      card: {
        id: `card-${i}`,
        name: `Card ${i + 1}`,
        color_identity: [],
      },
      zone: "graveyard" as ZoneType,
      playerId: id,
    })),
    exile: Array.from({ length: exileCount }, (_, i) => ({
      id: `${id}-exile-${i}`,
      card: {
        id: `card-${i}`,
        name: `Card ${i + 1}`,
        color_identity: [],
      },
      zone: "exile" as ZoneType,
      playerId: id,
    })),
    library: Array.from({ length: libraryCount }, (_, i) => ({
      id: `${id}-library-${i}`,
      card: {
        id: `card-${i}`,
        name: `Card ${i + 1}`,
        color_identity: [],
      },
      zone: "library" as ZoneType,
      playerId: id,
      faceDown: true,
    })),
    commandZone: isCommander
      ? [
          {
            id: `${id}-commander-0`,
            card: {
              id: `commander-0`,
              name: "Commander",
              color_identity: [],
            },
            zone: "commandZone" as ZoneType,
            playerId: id,
          },
        ]
      : [],
    isCurrentTurn: false,
    hasPriority: false,
  };
}

export default function GameBoardPage() {
  const [playerCount, setPlayerCount] = React.useState<PlayerCount>(2);
  const [currentTurnIndex, setCurrentTurnIndex] = React.useState(0);
  const [players, setPlayers] = React.useState<PlayerState[]>([]);
  const [timerEnabled, setTimerEnabled] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(true);
  const [aiAssistanceEnabled, setAiAssistanceEnabled] = React.useState(false);
  const [isAnalyzing, startAnalysis] = useTransition();
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiManaAdvice, setAiManaAdvice] = useState<AIManaAdvice | null>(null);
  const [aiBoardEval, setAiBoardEval] = useState<AIBoardEval | null>(null);
  const { toast } = useToast();

  // Get current player info
  const currentPlayer = players.length > 0 ? players[players.length - 1] : null;
  const currentPlayerId = currentPlayer?.id || "player-2";
  const currentPlayerName = currentPlayer?.name || "You";

  // Initialize chat
  const { 
    messages, 
    sendMessage, 
    addSystemMessage, 
    clearMessages,
    unreadCount,
    markAsRead 
  } = useGameChat({
    currentPlayerId,
    currentPlayerName,
  });

  // Initialize emotes
  const { emotes, sendEmote, clearEmotes } = useGameEmotes({
    currentPlayerId,
    currentPlayerName,
  });

  // Initialize damage events
  const { events: damageEvents, addDamage, addHeal, clearEvents: clearDamageEvents } = useDamageEvents();

  // Initialize players when player count changes
  React.useEffect(() => {
    const newPlayers: PlayerState[] = [];

    if (playerCount === 2) {
      newPlayers.push(
        generateMockPlayer("player-1", "Opponent", 20, false),
        generateMockPlayer("player-2", "You", 20, false)
      );
    } else if (playerCount === 4) {
      newPlayers.push(
        generateMockPlayer("player-1", "Player 1", 40, true),
        generateMockPlayer("player-2", "Player 2", 40, true),
        generateMockPlayer("player-3", "Player 3", 40, true),
        generateMockPlayer("player-4", "You", 40, true)
      );
    }

    setPlayers(newPlayers);
    setCurrentTurnIndex(0);
    clearMessages();
    clearEmotes();
  }, [playerCount, clearMessages, clearEmotes]);

  // Handle chat open/close
  React.useEffect(() => {
    if (chatOpen) {
      markAsRead();
    }
  }, [chatOpen, messages.length, markAsRead]);

  const handleCardClick = (cardId: string, zone: ZoneType) => {
    toast({
      title: "Card Selected",
      description: `Clicked card ${cardId} in ${zone}`,
    });
  };

  const handleZoneClick = (zone: ZoneType, playerId: string) => {
    const player = players.find((p) => p.id === playerId);
    let zoneData: unknown[] = [];
    
    // Map ZoneType to PlayerState properties
    switch (zone) {
      case "commandZone":
        zoneData = player?.commandZone || [];
        break;
      case "battlefield":
        zoneData = player?.battlefield || [];
        break;
      case "hand":
        zoneData = player?.hand || [];
        break;
      case "graveyard":
        zoneData = player?.graveyard || [];
        break;
      case "exile":
        zoneData = player?.exile || [];
        break;
      case "library":
        zoneData = player?.library || [];
        break;
      case "stack":
      case "sideboard":
      case "anticipate":
        // These zones don't exist in PlayerState yet
        zoneData = [];
        break;
    }

    toast({
      title: `${zone.charAt(0).toUpperCase() + zone.slice(1)} Zone`,
      description: `${player?.name}'s ${zone}: ${zoneData?.length || 0} cards`,
    });
  };

  const advanceTurn = () => {
    const nextIndex = (currentTurnIndex + 1) % players.length;
    setCurrentTurnIndex(nextIndex);

    // Update isCurrentTurn flags
    setPlayers((prev) =>
      prev.map((player, idx) => ({
        ...player,
        isCurrentTurn: idx === nextIndex,
      }))
    );
  };

  const damagePlayer = (playerIndex: number, amount: number) => {
    const targetPlayer = players[playerIndex];
    setPlayers((prev) =>
      prev.map((player, idx) =>
        idx === playerIndex
          ? { ...player, lifeTotal: Math.max(0, player.lifeTotal - amount) }
          : player
      )
    );
    // Show damage indicator
    if (targetPlayer) {
      addDamage(amount, 'combat', targetPlayer.id);
    }
  };

  const healPlayer = (playerIndex: number, amount: number) => {
    const targetPlayer = players[playerIndex];
    setPlayers((prev) =>
      prev.map((player, idx) =>
        idx === playerIndex
          ? { ...player, lifeTotal: player.lifeTotal + amount }
          : player
      )
    );
    // Show heal indicator
    if (targetPlayer) {
      addHeal(amount, targetPlayer.id);
    }
  };

  // Convert player state to game state format for AI analysis
  const convertToGameState = () => {
    const currentPlayer = players.find(p => p.id === currentPlayerId);
    const opponent = players.find(p => p.id !== currentPlayerId);
    
    return {
      players: players.map(p => ({
        id: p.id,
        name: p.name,
        lifeTotal: p.lifeTotal,
        poisonCounters: p.poisonCounters,
        hand: p.hand.map(c => c.card.name),
        battlefield: p.battlefield.map(c => c.card.name),
        graveyard: p.graveyard.map(c => c.card.name),
        library: p.library.length,
        mana: { 
          total: 3, // Mock value - would be calculated from actual game state
          colored: { W: 1, U: 1, B: 0, R: 0, G: 1 },
          colorless: 0
        },
        isCurrentTurn: p.isCurrentTurn,
      })),
      turn: currentTurnIndex + 1,
      phase: "main",
    };
  };

  // Handle AI assistance request
  const handleAIAssistance = () => {
    if (!currentPlayer) return;
    
    const gameState = convertToGameState();
    
    startAnalysis(async () => {
      try {
        // Get game state analysis
        const analysis = await analyzeCurrentGameState({
          gameState,
          playerName: currentPlayerName,
        });
        setAiAnalysis(analysis);
        
        // Get mana advice
        const mana = await getManaAdvice({
          gameState,
          playerName: currentPlayerName,
        });
        setAiManaAdvice(mana);
        
        // Get board evaluation
        const boardEval = await evaluateBoardState({
          gameState,
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
              Phase 2.1: Game Board Layout
            </p>
          </div>

          <Separator />

          {/* Configuration */}
          <div className="space-y-4">
            <h2 className="font-semibold text-sm">Configuration</h2>

            <div className="space-y-2">
              <Label htmlFor="player-count">Player Count</Label>
              <Select
                value={playerCount.toString()}
                onValueChange={(value) => setPlayerCount(Number(value) as PlayerCount)}
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

            <Button onClick={advanceTurn} className="w-full" variant="default">
              Advance Turn
            </Button>
          </div>

          <Separator />

          {/* Life Total Controls */}
          <div className="space-y-4">
            <h2 className="font-semibold text-sm">Life Total Controls</h2>

            {players.map((player, idx) => (
              <Card key={player.id} className={idx === players.length - 1 ? "border-primary/50" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    {player.name}
                    {player.isCurrentTurn && (
                      <span className="text-xs text-primary animate-pulse">Active</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-mono font-bold">{player.lifeTotal}</span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => damagePlayer(idx, 1)}
                      >
                        -1
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => healPlayer(idx, 1)}
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
                      onClick={() => damagePlayer(idx, 5)}
                    >
                      -5
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => healPlayer(idx, 5)}
                    >
                      +5
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Timer Toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="timer-toggle" className="text-sm">Turn Timer</Label>
            <input
              type="checkbox"
              id="timer-toggle"
              checked={timerEnabled}
              onChange={(e) => setTimerEnabled(e.target.checked)}
              className="toggle"
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
              <Label htmlFor="ai-toggle" className="text-xs">Enable AI Hints</Label>
              <input
                type="checkbox"
                id="ai-toggle"
                checked={aiAssistanceEnabled}
                onChange={(e) => setAiAssistanceEnabled(e.target.checked)}
                className="toggle"
              />
            </div>
            <Button 
              onClick={handleAIAssistance} 
              disabled={isAnalyzing || !aiAssistanceEnabled}
              variant="outline"
              className="w-full"
              size="sm"
            >
              {isAnalyzing ? "Analyzing..." : "Get AI Suggestions"}
            </Button>
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
              Demo Controls
            </h2>
            <p className="text-xs text-muted-foreground">
              This is a demonstration of the game board layout with mock data.
              Click on zones and cards to interact with the board.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Hover over zones to see card counts</li>
              <li>Click zones to view detailed contents</li>
              <li>Use life total controls to simulate damage</li>
              <li>Advance turn to see active player indicator</li>
              <li>Try both 2-player and 4-player layouts</li>
            </ul>
          </div>

          <Separator />

          {/* Info */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Phase 2.1 Features:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Responsive 2-player layout</li>
              <li>Responsive 4-player Commander layout</li>
              <li>All game zones displayed</li>
              <li>Command zone support</li>
              <li>Life total tracking</li>
              <li>Poison counter display</li>
              <li>Commander damage tracking</li>
              <li>Active turn indicator</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Game Board */}
      <div className="flex-1 h-full relative">
        {players.length > 0 && (
          <GameBoard
            players={players}
            playerCount={playerCount}
            currentTurnIndex={currentTurnIndex}
            onCardClick={handleCardClick}
            onZoneClick={handleZoneClick}
          />
        )}
        
        {/* Floating Chat Panel */}
        <div className="absolute bottom-4 right-4 w-80 z-10">
          {chatOpen ? (
            <GameChat
              messages={messages}
              currentPlayerId={currentPlayerId}
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
            >
              <MessageCircle className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          )}
        </div>
        
        {/* Floating Emote Feed */}
        <div className="absolute top-4 right-4 z-10">
          {emotes.length > 0 && (
            <EmoteFeed emotes={emotes} className="bg-card/90 p-2 rounded-lg shadow-lg" />
          )}
        </div>
        
        {/* Damage Indicators Overlay */}
        <DamageOverlay events={damageEvents} className="pointer-events-none" />
        
        {/* Floating AI Assistance Panel */}
        {(aiAnalysis || aiManaAdvice || aiBoardEval) && aiAssistanceEnabled && (
          <Card className="absolute top-4 left-4 w-72 max-h-[60vh] overflow-y-auto z-10 shadow-lg bg-card/95">
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
                    <span className={cn(
                      "font-bold",
                      (aiBoardEval.playerWinChance ?? 0) >= 60 ? "text-green-500" :
                      (aiBoardEval.playerWinChance ?? 0) >= 40 ? "text-yellow-500" : "text-red-500"
                    )}>
                      {aiBoardEval.playerWinChance ?? 0}%
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    Board: {aiBoardEval.boardAdvantage?.replace('_', ' ')}
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
                    <div key={idx} className={cn(
                      "p-2 rounded mb-1",
                      play.priority === 'high' ? 'bg-green-50 border-l-2 border-green-500' :
                      play.priority === 'medium' ? 'bg-yellow-50 border-l-2 border-yellow-500' :
                      'bg-gray-50'
                    )}>
                      <div className="font-medium">{play.cardName}</div>
                      <div className="text-muted-foreground text-[10px]">{play.reasoning}</div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Warnings */}
              {aiAnalysis?.warnings && aiAnalysis.warnings.length > 0 && (
                <div>
                  <div className="font-semibold mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-amber-500" /> Warnings:
                  </div>
                  {aiAnalysis.warnings.slice(0, 2).map((warning, idx) => (
                    <div key={idx} className={cn(
                      "p-2 rounded mb-1 text-[10px]",
                      warning.type === 'danger' ? 'bg-red-50 text-red-700' :
                      'bg-amber-50 text-amber-700'
                    )}>
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
                      <div className="text-muted-foreground text-[10px]">{suggestion.reasoning}</div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Strategic Advice */}
              {aiAnalysis?.strategicAdvice && aiAnalysis.strategicAdvice.length > 0 && (
                <div className="pt-2 border-t">
                  <div className="font-semibold mb-1">Strategic Advice:</div>
                  {aiAnalysis.strategicAdvice.slice(0, 2).map((advice: string, idx: number) => (
                    <div key={idx} className="text-muted-foreground text-[10px] mb-1">
                      • {advice}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
