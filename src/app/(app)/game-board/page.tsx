"use client";

import * as React from "react";
import { useState, useTransition, useCallback, useEffect } from "react";
import { GameBoard } from "@/components/game-board";
import { GameChat } from "@/components/game-chat";
import { EmotePicker, EmoteFeed } from "@/components/emote-picker";
import { TurnTimer } from "@/components/turn-timer";
import { DamageOverlay, useDamageEvents } from "@/components/damage-indicator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { PlayerState, PlayerCount, ZoneType } from "@/types/game";
import { Swords, Eye, MessageCircle, Smile, Lightbulb, AlertTriangle, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGameChat } from "@/hooks/use-game-chat";
import { useGameEmotes } from "@/hooks/use-game-emotes";
import { useGameEngine } from "@/hooks/use-game-engine";
import { cn } from "@/lib/utils";
import { analyzeCurrentGameState, getManaAdvice, evaluateBoardState } from "@/ai/flows/ai-gameplay-assistance";
import type { CardInstanceId, PlayerId } from "@/lib/game-state/types";

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

/**
 * @deprecated Mock data generator - kept for backward compatibility only.
 * Use useGameEngine hook instead for actual game state management.
 */
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
    isCurrentTurn: false,
    hasPriority: false,
    landsPlayedThisTurn: 0,
    hand: Array.from({ length: handCount }, (_, i) => ({
      id: `${id}-hand-${i}`,
      card: {
        id: `card-${i}`,
        name: `Card ${i + 1}`,
        color_identity: [],
        cmc: 0,
        type_line: 'Card',
        colors: [],
        legalities: {},
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
        cmc: 0,
        type_line: 'Creature',
        colors: [],
        legalities: {},
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
        cmc: 0,
        type_line: 'Card',
        colors: [],
        legalities: {},
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
        cmc: 0,
        type_line: 'Card',
        colors: [],
        legalities: {},
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
        cmc: 0,
        type_line: 'Card',
        colors: [],
        legalities: {},
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
              cmc: 0,
              type_line: 'Creature',
              colors: [],
              legalities: {},
            },
            zone: "commandZone" as ZoneType,
            playerId: id,
          },
        ]
      : [],
  };
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
  const [useEngine, setUseEngine] = React.useState(true); // Toggle between engine and mock
  const { toast } = useToast();

  // Initialize game engine
  const playerNames = playerCount === 2 
    ? ["Opponent", "You"] 
    : ["Player 1", "Player 2", "Player 3", "You"];
  
  const {
    gameState,
    engineState,
    isGameStarted,
    currentPlayerId,
    initializeGame,
    startGame,
    resetGame,
    advancePhase: engineAdvancePhase,
    nextTurn: engineNextTurn,
    playLand: enginePlayLand,
    castSpell: engineCastSpell,
    tapCard: engineTapCard,
    untapCard: engineUntapCard,
    declareAttackers: engineDeclareAttackers,
    declareBlockers: engineDeclareBlockers,
    damagePlayer: engineDamagePlayer,
    healPlayer: engineHealPlayer,
    concede: engineConcede,
    offerDraw: engineOfferDraw,
    acceptDraw: engineAcceptDraw,
    declineDraw: engineDeclineDraw,
    drawCard: engineDrawCard,
    canPlayLand,
    canCastSpell,
  } = useGameEngine({
    playerNames,
    startingLife: playerCount === 2 ? 20 : 40,
    isCommander: playerCount === 4,
    autoStart: false,
  });

  // Use engine state if available, otherwise fall back to mock state
  const players = gameState?.players || [];
  const currentTurnIndex = gameState?.currentTurnPlayerIndex || 0;
  const currentPlayer = players.length > 0 ? players[players.length - 1] : null;
  const currentPlayerIdLocal = currentPlayerId || currentPlayer?.id || "player-2";
  const currentPlayerName = currentPlayer?.name || "You";

  // Initialize chat
  const {
    messages,
    sendMessage,
    clearMessages,
    unreadCount,
    markAsRead
  } = useGameChat({
    currentPlayerId: currentPlayerIdLocal,
    currentPlayerName,
  });

  // Initialize emotes
  const { emotes, sendEmote, clearEmotes } = useGameEmotes({
    currentPlayerId: currentPlayerIdLocal,
    currentPlayerName,
  });

  // Initialize damage events
  const { events: damageEvents, addDamage, addHeal } = useDamageEvents();

  // Initialize game when player count changes
  React.useEffect(() => {
    if (useEngine) {
      // Reset and reinitialize with engine
      resetGame();
      initializeGame();
    } else {
      // Fall back to mock data
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

      clearMessages();
      clearEmotes();
    }
  }, [playerCount, useEngine]);

  // Auto-start game when initialized
  React.useEffect(() => {
    if (useEngine && engineState && !isGameStarted) {
      startGame();
    }
  }, [useEngine, engineState, isGameStarted, startGame]);

  // Handle chat open/close
  React.useEffect(() => {
    if (chatOpen) {
      markAsRead();
    }
  }, [chatOpen, messages.length, markAsRead]);

  // Handle card click - integrated with engine
  const handleCardClick = useCallback((cardId: string, zone: ZoneType) => {
    if (useEngine && engineState) {
      // Engine integration - handle card interactions
      const card = engineState.cards.get(cardId as CardInstanceId);
      
      if (zone === "battlefield" && card) {
        // Toggle tap/untap for battlefield cards
        if (card.isTapped) {
          engineUntapCard(cardId as CardInstanceId);
          toast({
            title: "Card Untapped",
            description: `${card.cardData.name} was untapped`,
          });
        } else {
          engineTapCard(cardId as CardInstanceId);
          toast({
            title: "Card Tapped",
            description: `${card.cardData.name} was tapped`,
          });
        }
      } else if (zone === "hand" && card) {
        // Card in hand - show details or offer to play
        const canPlayLandResult = canPlayLand(currentPlayerIdLocal);
        const canCastSpellResult = canCastSpell(currentPlayerIdLocal, cardId as CardInstanceId);
        
        if (card.cardData.type_line?.toLowerCase().includes("land") && canPlayLandResult) {
          const result = enginePlayLand(cardId as CardInstanceId);
          if (result.success) {
            toast({
              title: "Land Played",
              description: `${card.cardData.name} was played`,
            });
          } else {
            toast({
              title: "Cannot Play Land",
              description: result.error || "You cannot play a land right now",
              variant: "destructive",
            });
          }
        } else if (canCastSpellResult) {
          toast({
            title: "Spell Ready",
            description: `${card.cardData.name} can be cast (mana required)`,
          });
        } else {
          toast({
            title: "Card Selected",
            description: `${card.cardData.name} - ${card.cardData.type_line}`,
          });
        }
      } else {
        toast({
          title: "Card Selected",
          description: `${card?.cardData.name || cardId} in ${zone}`,
        });
      }
    } else {
      // Legacy mock data handling
      toast({
        title: "Card Selected",
        description: `Clicked card ${cardId} in ${zone}`,
      });
    }
  }, [useEngine, engineState, currentPlayerIdLocal, engineUntapCard, engineTapCard, enginePlayLand, canPlayLand, canCastSpell, toast]);

  const handleZoneClick = (zone: ZoneType, playerId: string) => {
    if (useEngine && engineState) {
      const player = engineState.players.get(playerId as PlayerId);
      const zoneKey = `${playerId}-${zone === "commandZone" ? "command" : zone}`;
      const zoneData = engineState.zones.get(zoneKey);
      
      toast({
        title: `${zone.charAt(0).toUpperCase() + zone.slice(1)} Zone`,
        description: `${player?.name}'s ${zone}: ${zoneData?.cardIds.length || 0} cards`,
      });
    } else {
      // Legacy mock data handling
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
    }
  };

  const advanceTurn = () => {
    if (useEngine && engineState) {
      // Use engine's turn advancement
      engineNextTurn();
      toast({
        title: "Turn Advanced",
        description: `Now ${engineState.players.get(engineState.turn.activePlayerId)?.name}'s turn`,
      });
    } else {
      // Legacy mock data handling
      const nextIndex = (currentTurnIndex + 1) % players.length;
      
      // Update isCurrentTurn flags
      // This is handled by the engine now
      toast({
        title: "Turn Advanced",
        description: `Now ${players[nextIndex]?.name}'s turn`,
      });
    }
  };

  const damagePlayer = (playerIndex: number, amount: number) => {
    if (useEngine && engineState) {
      // Use engine for damage
      const playerIds = Array.from(engineState.players.keys());
      const targetPlayerId = playerIds[playerIndex];
      if (targetPlayerId) {
        engineDamagePlayer(targetPlayerId as PlayerId, amount);
        addDamage(amount, 'combat', targetPlayerId);
        toast({
          title: "Damage Dealt",
          description: `${amount} damage dealt to ${engineState.players.get(targetPlayerId)?.name}`,
        });
      }
    } else {
      // Legacy mock data handling
      const targetPlayer = players[playerIndex];
      if (targetPlayer) {
        addDamage(amount, 'combat', targetPlayer.id);
        toast({
          title: "Damage Dealt",
          description: `${amount} damage dealt to ${targetPlayer.name}`,
        });
      }
    }
  };

  const healPlayer = (playerIndex: number, amount: number) => {
    if (useEngine && engineState) {
      // Use engine for healing
      const playerIds = Array.from(engineState.players.keys());
      const targetPlayerId = playerIds[playerIndex];
      if (targetPlayerId) {
        engineHealPlayer(targetPlayerId as PlayerId, amount);
        addHeal(amount, targetPlayerId);
        toast({
          title: "Life Gained",
          description: `${amount} life gained by ${engineState.players.get(targetPlayerId)?.name}`,
        });
      }
    } else {
      // Legacy mock data handling
      const targetPlayer = players[playerIndex];
      if (targetPlayer) {
        addHeal(amount, targetPlayer.id);
        toast({
          title: "Life Gained",
          description: `${amount} life gained by ${targetPlayer.name}`,
        });
      }
    }
  };

  // Convert player state to game state format for AI analysis
  const convertToGameState = () => {
    if (useEngine && engineState) {
      // Use actual engine state for AI analysis
      const playersMap: { [id: string]: any } = {};
      
      // Convert engine phase to UI phase
      const phaseMap: Record<string, "beginning" | "precombat_main" | "combat" | "postcombat_main" | "end"> = {
        untap: "beginning",
        upkeep: "beginning",
        draw: "beginning",
        precombat_main: "precombat_main",
        begin_combat: "combat",
        declare_attackers: "combat",
        declare_blockers: "combat",
        combat_damage_first_strike: "combat",
        combat_damage: "combat",
        end_combat: "combat",
        postcombat_main: "postcombat_main",
        end: "end",
        cleanup: "end",
      };

      engineState.players.forEach((player, playerId) => {
        const handZone = engineState.zones.get(`${playerId}-hand`);
        const battlefieldZone = engineState.zones.get(`${playerId}-battlefield`);
        
        playersMap[playerId] = {
          id: playerId,
          name: player.name,
          life: player.life,
          poisonCounters: player.poisonCounters,
          hand: handZone?.cardIds.map(cardId => {
            const card = engineState.cards.get(cardId);
            return {
              cardId,
              name: card?.cardData.name || "Unknown",
              type: card?.cardData.type_line || "Unknown",
              manaValue: card?.cardData.cmc || 0,
            };
          }) || [],
          battlefield: battlefieldZone?.cardIds.map(cardId => {
            const card = engineState.cards.get(cardId);
            return {
              id: cardId,
              cardId,
              name: card?.cardData.name || "Unknown",
              type: card?.cardData.type_line?.toLowerCase().includes("creature") ? "creature" : "other",
              controller: playerId,
              manaValue: card?.cardData.cmc || 0,
              tapped: card?.isTapped || false,
            };
          }) || [],
          manaPool: player.manaPool,
        };
      });

      return {
        players: playersMap,
        turnInfo: {
          currentTurn: engineState.turn.turnNumber,
          currentPlayer: engineState.turn.activePlayerId,
          phase: phaseMap[engineState.turn.currentPhase] || "precombat_main",
          priority: engineState.priorityPlayerId || engineState.turn.activePlayerId,
        },
        stack: engineState.stack.map(obj => ({
          cardId: obj.sourceCardId || "",
          controller: obj.controllerId,
          type: obj.type,
          targets: obj.targets?.map(t => t.targetId) || [],
        })),
      };
    }

    // Legacy mock data conversion
    const playersMap: { [id: string]: any } = {};
    players.forEach(p => {
      playersMap[p.id] = {
        id: p.id,
        name: p.name,
        life: p.lifeTotal,
        poisonCounters: p.poisonCounters,
        hand: p.hand.map(c => ({
          cardId: c.id,
          name: c.card.name,
          type: c.card.type_line,
          manaValue: c.card.cmc,
        })),
        battlefield: p.battlefield.map(c => ({
          id: c.id,
          cardId: c.card.id,
          name: c.card.name,
          type: 'creature', // Simplified
          controller: p.id,
          manaValue: c.card.cmc,
        })),
        manaPool: { colorless: 1, white: 1, blue: 1, black: 0, red: 0, green: 0, generic: 0 },
      };
    });

    return {
      players: playersMap,
      turnInfo: {
        currentTurn: 1, // Mock value
        currentPlayer: players[currentTurnIndex]?.id || "player-1",
        phase: "precombat_main" as const,
        priority: players[currentTurnIndex]?.id || "player-1",
      },
      stack: [],
    };
  };

  // Handle concede
  const handleConcede = () => {
    if (useEngine && currentPlayerIdLocal) {
      engineConcede(currentPlayerIdLocal as PlayerId);
      toast({
        title: "Game Conceded",
        description: "You have conceded the game",
      });
    }
  };

  // Handle offer draw
  const handleOfferDraw = () => {
    if (useEngine && currentPlayerIdLocal) {
      engineOfferDraw(currentPlayerIdLocal as PlayerId);
      toast({
        title: "Draw Offered",
        description: "You have offered a draw to all players",
      });
    }
  };

  // Handle accept draw
  const handleAcceptDraw = () => {
    if (useEngine && currentPlayerIdLocal) {
      engineAcceptDraw(currentPlayerIdLocal as PlayerId);
      toast({
        title: "Draw Accepted",
        description: "The game ends in a draw",
      });
    }
  };

  // Handle decline draw
  const handleDeclineDraw = () => {
    if (useEngine && currentPlayerIdLocal) {
      engineDeclineDraw(currentPlayerIdLocal as PlayerId);
      toast({
        title: "Draw Declined",
        description: "The draw offer has been declined",
      });
    }
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

            <div className="flex items-center justify-between">
              <Label htmlFor="engine-toggle" className="text-sm">Use Game Engine</Label>
              <input
                type="checkbox"
                id="engine-toggle"
                checked={useEngine}
                onChange={(e) => setUseEngine(e.target.checked)}
                className="toggle"
              />
            </div>
            {useEngine && (
              <p className="text-xs text-muted-foreground">
                Using actual game state engine. {isGameStarted ? "Game in progress." : "Initializing..."}
              </p>
            )}

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
              {useEngine ? "Engine Controls" : "Demo Controls"}
            </h2>
            {useEngine ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Game engine is active. Click cards to interact:
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Click battlefield cards to tap/untap</li>
                  <li>Click land cards in hand to play them (during main phase)</li>
                  <li>Click spell cards to see casting info</li>
                  <li>Use life total controls for damage/healing</li>
                  <li>Advance Turn to progress to next player</li>
                  <li>Concede or Offer Draw from game board menu</li>
                </ul>
                <div className="mt-2 p-2 rounded bg-primary/10 text-xs">
                  <strong>Engine Status:</strong> {isGameStarted ? "Running" : "Initializing"} | 
                  Turn: {gameState?.turnNumber || 0} | 
                  Phase: {gameState?.currentPhase || "N/A"}
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>

          <Separator />

          {/* Info */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium">{useEngine ? "Game Engine Features:" : "Phase 2.1 Features:"}</p>
            <ul className="space-y-1 list-disc list-inside">
              {useEngine ? (
                <>
                  <li>Full game state management</li>
                  <li>Turn phase progression</li>
                  <li>Land playing (one per turn)</li>
                  <li>Spell casting with mana validation</li>
                  <li>Card tap/untap mechanics</li>
                  <li>Combat system (attackers/blockers)</li>
                  <li>Damage and life tracking</li>
                  <li>Concede and draw offers</li>
                  <li>State-based actions</li>
                </>
              ) : (
                <>
                  <li>Responsive 2-player layout</li>
                  <li>Responsive 4-player Commander layout</li>
                  <li>All game zones displayed</li>
                  <li>Command zone support</li>
                  <li>Life total tracking</li>
                  <li>Poison counter display</li>
                  <li>Commander damage tracking</li>
                  <li>Active turn indicator</li>
                </>
              )}
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
            onConcede={handleConcede}
            onOfferDraw={handleOfferDraw}
            onAcceptDraw={handleAcceptDraw}
            onDeclineDraw={handleDeclineDraw}
            hasActiveDrawOffer={useEngine ? (engineState?.players.get(currentPlayerIdLocal as PlayerId)?.hasOfferedDraw ?? false) : false}
            hasPlayerOfferedDraw={useEngine ? (engineState?.players.get(currentPlayerIdLocal as PlayerId)?.hasOfferedDraw ?? false) : false}
            isGameOver={useEngine ? (engineState?.status === "completed") : false}
            damageEvents={damageEvents}
          />
        )}
        
        {/* Floating Chat Panel */}
        <div className="absolute bottom-4 right-4 w-80 z-10">
          {chatOpen ? (
            <GameChat
              messages={messages}
              currentPlayerId={currentPlayerIdLocal}
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
