/**
 * Game Board Page - Single Player Implementation
 * Displays the active game board for single-player games against AI or self-play
 * 
 * Issue #521: Connect single-player UI to game engine (implement playable game)
 */

'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Heart, Clock, Info, RotateCcw, Play, Pause, SkipForward } from 'lucide-react';
import { GameBoard } from '@/components/game-board';
import type { PlayerCount } from '@/types/game';
import { useToast } from '@/hooks/use-toast';
import type { ScryfallCard } from '@/app/actions';

// Game engine imports
import {
  createInitialGameState,
  loadDeckForPlayer,
  startGame,
  drawCard,
  passPriority,
  checkStateBasedActions,
  concede,
  serializeGameState,
  deserializeGameState,
  type GameState,
  type Player,
  type CardInstance,
  type Phase,
} from '@/lib/game-state';

// AI imports
import { GameStateEvaluator, type GameState as AIGameState } from '@/ai/game-state-evaluator';
import { getDifficultyConfig, type DifficultyLevel } from '@/ai/ai-difficulty';
import { CombatDecisionTree } from '@/ai/decision-making';

// Local storage for active games
import { savedGamesManager, createSavedGame } from '@/lib/saved-games';

// Sample basic lands for deck generation
const BASIC_LANDS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

/**
 * Generate a simple deck for testing/demo purposes
 * In a real implementation, this would use the player's actual deck
 */
function generateSimpleDeck(): ScryfallCard[] {
  const deck: ScryfallCard[] = [];
  
  // 24 basic lands (even distribution)
  for (let i = 0; i < 24; i++) {
    const landName = BASIC_LANDS[i % 5];
    deck.push({
      id: `land-${i}`,
      name: landName,
      type_line: 'Basic Land',
      mana_cost: '',
      oracle_text: landName === 'Plains' ? '{T}: Add {W}' :
                   landName === 'Island' ? '{T}: Add {U}' :
                   landName === 'Swamp' ? '{T}: Add {B}' :
                   landName === 'Mountain' ? '{T}: Add {R}' :
                   '{T}: Add {G}',
      colors: [],
      color_identity: [landName === 'Plains' ? 'W' :
                       landName === 'Island' ? 'U' :
                       landName === 'Swamp' ? 'B' :
                       landName === 'Mountain' ? 'R' : 'G'],
      legalities: { standard: 'legal', modern: 'legal', commander: 'legal' },
      images: { normal: '', art_crop: '' },
      cmc: 0,
      power: undefined,
      toughness: undefined,
    } as ScryfallCard);
  }
  
  // 36 creature spells (simple bears for demo)
  for (let i = 0; i < 36; i++) {
    const isGrizzly = i % 2 === 0;
    deck.push({
      id: `creature-${i}`,
      name: isGrizzly ? 'Grizzly Bears' : 'Balduvian Bears',
      type_line: 'Creature — Bear',
      mana_cost: '{1}{G}',
      oracle_text: '',
      colors: ['G'],
      color_identity: ['G'],
      legalities: { standard: 'legal', modern: 'legal', commander: 'legal' },
      images: { normal: '', art_crop: '' },
      cmc: 2,
      power: '2',
      toughness: '2',
    } as ScryfallCard);
  }
  
  return deck;
}

/**
 * Convert engine GameState to AI-evaluable format
 */
function convertToAIGameState(engineState: GameState, evaluatingPlayerId: string): AIGameState {
  const players: { [key: string]: any } = {};
  
  engineState.players.forEach((player, playerId) => {
    const battlefield = Array.from(engineState.cards.values())
      .filter(card => {
        const zone = engineState.zones.get(`${playerId}-battlefield`);
        return zone?.cardIds.includes(card.id);
      })
      .map(card => ({
        id: card.id,
        cardId: card.oracleId,
        name: card.cardData.name,
        type: card.cardData.type_line.toLowerCase().includes('creature') ? 'creature' :
              card.cardData.type_line.toLowerCase().includes('land') ? 'land' : 'other',
        controller: card.controllerId,
        tapped: card.isTapped,
        power: card.cardData.power ? parseInt(card.cardData.power) : 0,
        toughness: card.cardData.toughness ? parseInt(card.cardData.toughness) : 0,
        manaValue: card.cardData.cmc,
      }));
    
    const handZone = engineState.zones.get(`${playerId}-hand`);
    const handCards = handZone?.cardIds.map(id => {
      const card = engineState.cards.get(id);
      return {
        cardId: card?.oracleId || '',
        name: card?.cardData.name || 'Unknown',
        type: card?.cardData.type_line || 'Unknown',
        manaValue: card?.cardData.cmc || 0,
      };
    }) || [];
    
    const graveyardZone = engineState.zones.get(`${playerId}-graveyard`);
    const libraryZone = engineState.zones.get(`${playerId}-library`);
    
    players[playerId] = {
      id: playerId,
      life: player.life,
      poisonCounters: player.poisonCounters,
      commanderDamage: Object.fromEntries(player.commanderDamage),
      hand: handCards,
      graveyard: graveyardZone?.cardIds || [],
      exile: [],
      library: libraryZone?.cardIds.length || 0,
      battlefield,
      manaPool: {
        W: player.manaPool.white,
        U: player.manaPool.blue,
        B: player.manaPool.black,
        R: player.manaPool.red,
        G: player.manaPool.green,
        C: player.manaPool.colorless,
      },
    };
  });
  
  return {
    players,
    turnInfo: {
      currentTurn: engineState.turn.turnNumber,
      currentPlayer: engineState.turn.activePlayerId,
      phase: engineState.turn.currentPhase as any,
      priority: engineState.priorityPlayerId || '',
    },
    stack: engineState.stack.map(s => ({
      cardId: s.sourceCardId || '',
      controller: s.controllerId,
      type: s.type,
    })),
  };
}

/**
 * AI Opponent class for single-player games
 */
class AIOpponent {
  private difficulty: DifficultyLevel;
  private evaluator: GameStateEvaluator | null = null;
  private combatDecider: CombatDecisionTree | null = null;
  
  constructor(difficulty: DifficultyLevel = 'medium') {
    this.difficulty = difficulty;
  }
  
  /**
   * Evaluate the current game state from AI's perspective
   */
  evaluateState(gameState: GameState, aiPlayerId: string): { score: number; recommendations: string[] } {
    try {
      const aiState = convertToAIGameState(gameState, aiPlayerId);
      this.evaluator = new GameStateEvaluator(aiState, aiPlayerId, this.difficulty);
      const evaluation = this.evaluator.evaluate();
      
      return {
        score: evaluation.totalScore,
        recommendations: evaluation.recommendedActions,
      };
    } catch (error) {
      console.error('AI evaluation error:', error);
      return { score: 0, recommendations: [] };
    }
  }
  
  /**
   * Decide whether to attack
   */
  shouldAttack(gameState: GameState, aiPlayerId: string): boolean {
    const aiState = convertToAIGameState(gameState, aiPlayerId);
    this.combatDecider = new CombatDecisionTree(aiState, aiPlayerId, this.difficulty);
    
    const attackDecision = this.combatDecider.shouldAttack();
    return attackDecision.shouldAttack;
  }
  
  /**
   * Decide which creatures to attack with
   */
  getAttackers(gameState: GameState, aiPlayerId: string): string[] {
    const aiState = convertToAIGameState(gameState, aiPlayerId);
    this.combatDecider = new CombatDecisionTree(aiState, aiPlayerId, this.difficulty);
    
    const attackDecision = this.combatDecider.shouldAttack();
    return attackDecision.attackers || [];
  }
  
  /**
   * Decide whether to block and with what
   */
  getBlockers(gameState: GameState, aiPlayerId: string, attackerIds: string[]): { [attackerId: string]: string[] } {
    const aiState = convertToAIGameState(gameState, aiPlayerId);
    this.combatDecider = new CombatDecisionTree(aiState, aiPlayerId, this.difficulty);
    
    const blockDecisions = this.combatDecider.shouldBlock(attackerIds);
    return blockDecisions.blockAssignments || {};
  }
  
  /**
   * Make a decision for the AI's turn
   */
  makeDecision(gameState: GameState, aiPlayerId: string): {
    action: 'play_land' | 'cast_spell' | 'attack' | 'pass' | 'tap_mana';
    data?: any;
  } {
    const config = getDifficultyConfig(this.difficulty);
    
    // Apply randomness based on difficulty
    if (Math.random() < config.randomnessFactor) {
      // Make a random/silly move
      return { action: 'pass' };
    }
    
    const evaluation = this.evaluateState(gameState, aiPlayerId);
    
    // Simple decision logic based on evaluation
    if (evaluation.score > 0.5) {
      // Ahead - play aggressively
      if (gameState.turn.currentPhase === 'declare_attackers') {
        const attackers = this.getAttackers(gameState, aiPlayerId);
        if (attackers.length > 0) {
          return { action: 'attack', data: { attackers } };
        }
      }
      return { action: 'play_land' };
    } else if (evaluation.score < -0.5) {
      // Behind - play defensively
      return { action: 'pass' };
    }
    
    // Default: play lands and develop board
    return { action: 'play_land' };
  }
}

/**
 * Get or create active game from storage
 */
async function getOrCreateActiveGame(
  gameId: string,
  playerName: string,
  mode: 'ai' | 'self-play',
  difficulty: DifficultyLevel
): Promise<{ gameState: GameState; isNew: boolean }> {
  // Try to load from saved games
  const savedGame = await savedGamesManager.getSavedGame(gameId);
  
  if (savedGame) {
    try {
      const gameState = JSON.parse(savedGame.gameStateJson) as GameState;
      return { gameState, isNew: false };
    } catch (error) {
      console.error('Failed to parse saved game state:', error);
    }
  }
  
  // Create new game
  const opponentName = mode === 'ai' ? `AI (${getDifficultyConfig(difficulty).displayName})` : 'You (Self Play)';
  const gameState = createInitialGameState([playerName, opponentName], 20, false);
  
  // Generate and load decks for both players
  const playerDeck = generateSimpleDeck();
  const opponentDeck = generateSimpleDeck();
  
  const player = Array.from(gameState.players.values())[0];
  const opponent = Array.from(gameState.players.values())[1];
  
  let updatedState = loadDeckForPlayer(gameState, player.id, playerDeck);
  updatedState = loadDeckForPlayer(updatedState, opponent.id, opponentDeck);
  
  // Start the game (draw opening hands)
  updatedState = startGame(updatedState);
  updatedState.status = 'in_progress';
  
  return { gameState: updatedState, isNew: true };
}

/**
 * Save game state to storage
 */
async function saveActiveGame(gameState: GameState): Promise<void> {
  try {
    await savedGamesManager.saveToAutoSave(gameState, null, 0);
  } catch (error) {
    console.error('Failed to save game state:', error);
  }
}

function GameBoardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>('Player');
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  
  const aiOpponentRef = useRef<AIOpponent | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get game parameters from URL
  const gameId = searchParams.get('id');
  const mode = searchParams.get('mode') as 'ai' | 'self-play' || 'ai';
  const difficulty = searchParams.get('difficulty') as DifficultyLevel || 'medium';
  
  // Initialize AI opponent
  useEffect(() => {
    if (mode === 'ai') {
      aiOpponentRef.current = new AIOpponent(difficulty);
    }
  }, [mode, difficulty]);
  
  // Load or create game
  useEffect(() => {
    const initializeGame = async () => {
      try {
        setIsLoading(true);
        
        // Get player name from localStorage
        const storedName = localStorage.getItem('planar_nexus_player_name') || 'Player';
        setPlayerName(storedName);
        
        if (gameId) {
          const { gameState: loadedState, isNew } = await getOrCreateActiveGame(
            gameId,
            storedName,
            mode,
            difficulty
          );
          
          setGameState(loadedState);
          
          if (isNew) {
            // Save initial state
            await saveActiveGame(loadedState);
            
            toast({
              title: 'Game Started',
              description: `Playing against ${mode === 'ai' ? 'AI Opponent' : 'Self Play'}`,
            });
          }
        } else {
          // Create new game with new ID
          const newGameId = `GAME-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
          const { gameState: newState } = await getOrCreateActiveGame(
            newGameId,
            storedName,
            mode,
            difficulty
          );
          
          setGameState(newState);
          await saveActiveGame(newState);
          
          // Update URL with game ID
          router.replace(`/game/${newGameId}?id=${newGameId}&mode=${mode}&difficulty=${difficulty}`);
          
          toast({
            title: 'Game Started',
            description: `Playing against ${mode === 'ai' ? 'AI Opponent' : 'Self Play'}`,
          });
        }
        
        setError(null);
      } catch (err) {
        console.error('Failed to initialize game:', err);
        setError('Failed to load game. Please try again.');
        toast({
          title: 'Error',
          description: 'Failed to initialize game state.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };
    
    initializeGame();
  }, [gameId, mode, difficulty, router, toast]);
  
  // Auto-save game state periodically
  useEffect(() => {
    if (autoSaveEnabled && gameState && gameState.status === 'in_progress') {
      autoSaveTimerRef.current = setInterval(async () => {
        if (gameId) {
          await saveActiveGame(gameState);
        }
      }, 30000); // Save every 30 seconds
    }
    
    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
  }, [autoSaveEnabled, gameState, gameId]);
  
  // Execute AI turn when it's AI's turn
  useEffect(() => {
    if (!gameState || mode !== 'ai' || !aiOpponentRef.current) return;
    
    const aiPlayer = Array.from(gameState.players.values()).find(
      p => p.name.includes('AI')
    );
    
    if (!aiPlayer || gameState.turn.activePlayerId !== aiPlayer.id) return;
    if (gameState.status !== 'in_progress') return;
    
    const executeAITurn = async () => {
      setIsAIThinking(true);
      
      // Simulate thinking time based on difficulty
      const config = getDifficultyConfig(difficulty);
      const thinkTime = 500 + (config.lookaheadDepth * 300);
      
      await new Promise(resolve => setTimeout(resolve, thinkTime));
      
      // Get AI decision
      const decision = aiOpponentRef.current!.makeDecision(gameState, aiPlayer.id);
      
      // Execute the decision
      let newState = { ...gameState };
      
      switch (decision.action) {
        case 'pass':
          newState = passPriority(newState, aiPlayer.id);
          toast({
            title: 'AI Turn',
            description: 'AI opponent passed priority',
          });
          break;
          
        case 'attack':
          // Combat logic would go here
          toast({
            title: 'AI Turn',
            description: 'AI is attacking!',
          });
          break;
          
        default:
          // Default: pass priority for now
          newState = passPriority(newState, aiPlayer.id);
          break;
      }
      
      // Check state-based actions
      newState = checkStateBasedActions(newState);
      
      // Save updated state
      setGameState(newState);
      await saveActiveGame(newState);
      
      setIsAIThinking(false);
    };
    
    executeAITurn();
  }, [gameState?.turn.activePlayerId, gameState?.turn.turnNumber, mode, difficulty, toast]);
  
  // Check for game end
  useEffect(() => {
    if (!gameState) return;
    
    if (gameState.status === 'completed' && gameState.winners.length > 0) {
      const winner = gameState.players.get(gameState.winners[0]);
      toast({
        title: 'Game Over',
        description: `${winner?.name} wins!`,
      });
    } else if (gameState.status === 'completed' && gameState.winners.length === 0) {
      toast({
        title: 'Game Over',
        description: 'The game ended in a draw',
      });
    }
  }, [gameState?.status, gameState?.winners, toast]);
  
  // Handle card click
  const handleCardClick = useCallback((cardId: string, zone: string) => {
    console.log('Card clicked:', cardId, 'in zone:', zone);
    // TODO: Implement card interaction logic
  }, []);
  
  // Handle zone click
  const handleZoneClick = useCallback((zone: string, playerId: string) => {
    console.log('Zone clicked:', zone, 'for player:', playerId);
    // TODO: Implement zone interaction logic
  }, []);
  
  // Handle concede
  const handleConcede = useCallback(async () => {
    if (!gameState) return;
    
    if (confirm('Are you sure you want to concede?')) {
      const player = Array.from(gameState.players.values()).find(p => p.name === playerName);
      if (player) {
        const newState = concede(gameState, player.id);
        setGameState(newState);
        await saveActiveGame(newState);
        
        toast({
          title: 'Game Over',
          description: 'You conceded the game.',
        });
        
        // Navigate back after a delay
        setTimeout(() => {
          router.push('/single-player');
        }, 2000);
      }
    }
  }, [gameState, playerName, router, toast]);
  
  // Handle draw offer
  const handleOfferDraw = useCallback(() => {
    toast({
      title: 'Draw Offered',
      description: 'Draw offer sent to opponent.',
    });
  }, [toast]);
  
  const handleAcceptDraw = useCallback(() => {
    toast({
      title: 'Draw Accepted',
      description: 'The game ended in a draw.',
    });
    router.push('/single-player');
  }, [router, toast]);
  
  const handleDeclineDraw = useCallback(() => {
    toast({
      title: 'Draw Declined',
      description: 'The game continues.',
    });
  }, [toast]);
  
  // Handle pass priority (for self-play)
  const handlePassPriority = useCallback(async () => {
    if (!gameState) return;
    
    const player = Array.from(gameState.players.values()).find(p => p.name === playerName);
    if (player && gameState.priorityPlayerId === player.id) {
      let newState = passPriority(gameState, player.id);
      newState = checkStateBasedActions(newState);
      setGameState(newState);
      
      if (autoSaveEnabled) {
        await saveActiveGame(newState);
      }
    }
  }, [gameState, playerName, autoSaveEnabled]);
  
  // Handle advance phase (for self-play debugging)
  const handleAdvancePhase = useCallback(async () => {
    if (!gameState) return;
    
    // Force advance to next phase by passing priority multiple times
    let newState = { ...gameState };
    const maxPasses = 10;
    
    for (let i = 0; i < maxPasses; i++) {
      const currentPlayer = newState.players.get(newState.priorityPlayerId!);
      if (!currentPlayer) break;
      
      newState = passPriority(newState, currentPlayer.id);
      newState = checkStateBasedActions(newState);
      
      // Check if phase changed
      if (newState.turn.currentPhase !== gameState.turn.currentPhase) {
        break;
      }
    }
    
    setGameState(newState);
    if (autoSaveEnabled) {
      await saveActiveGame(newState);
    }
  }, [gameState, autoSaveEnabled]);
  
  if (isLoading) {
    return (
      <div className="flex-1 p-4 md:p-6 flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-muted rounded"></div>
              <div className="h-4 bg-muted rounded w-3/4"></div>
              <div className="h-4 bg-muted rounded w-1/2"></div>
            </div>
            <p className="text-muted-foreground">Initializing game...</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (error || !gameState) {
    return (
      <div className="flex-1 p-4 md:p-6">
        <Button variant="ghost" onClick={() => router.push('/single-player')} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Card className="max-w-md mx-auto">
          <CardContent className="p-6">
            <Alert variant="destructive">
              <AlertDescription>
                {error || 'Game not found'}
              </AlertDescription>
            </Alert>
            <Button onClick={() => router.push('/single-player')} className="mt-4 w-full">
              Return to Menu
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const currentPlayer = gameState.players.get(gameState.turn.activePlayerId);
  const isPlayerTurn = currentPlayer?.name === playerName;
  const isGameEnded = gameState.status === 'completed';
  
  // Convert game state players to UI format
  const uiPlayers = Array.from(gameState.players.values()).map(player => {
    // Get cards in each zone
    const getCardsInZone = (zoneType: string) => {
      const zone = gameState.zones.get(`${player.id}-${zoneType}`);
      if (!zone) return [];
      
      return zone.cardIds
        .map(id => gameState.cards.get(id))
        .filter((card): card is CardInstance => card !== undefined)
        .map(card => ({
          id: card.id,
          card: card.cardData,
          zone: zoneType as any,
          playerId: player.id,
          tapped: card.isTapped,
          faceDown: card.isFaceDown,
        }));
    };
    
    return {
      id: player.id,
      name: player.name,
      lifeTotal: player.life,
      poisonCounters: player.poisonCounters,
      commanderDamage: {},
      hand: getCardsInZone('hand'),
      battlefield: getCardsInZone('battlefield'),
      graveyard: getCardsInZone('graveyard'),
      exile: getCardsInZone('exile'),
      library: getCardsInZone('library'),
      commandZone: [],
      isCurrentTurn: player.id === gameState.turn.activePlayerId,
      hasPriority: player.id === gameState.priorityPlayerId,
    };
  });
  
  // Sort so player is at bottom (index 1)
  const sortedPlayers = uiPlayers.sort((a, b) => {
    if (a.name === playerName) return 1;
    if (b.name === playerName) return -1;
    return 0;
  });
  
  const currentTurnIndex = sortedPlayers.findIndex(p => p.isCurrentTurn);

  return (
    <div className="flex-1 p-0 h-screen w-screen overflow-hidden">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push('/single-player')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="font-headline text-lg font-bold">Single Player Game</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">Game {gameId}</Badge>
                <span>Turn {gameState.turn.turnNumber}</span>
              </div>
            </div>
          </div>
  
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium flex items-center gap-2">
                {currentPlayer?.name}&apos;s Turn
                {isAIThinking && (
                  <Badge variant="secondary" className="animate-pulse">
                    AI Thinking...
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground capitalize">
                {gameState.turn.currentPhase.replace('_', ' ')}
              </div>
            </div>
            <Badge variant={mode === 'ai' ? 'default' : 'secondary'}>
              {mode === 'ai' ? `vs AI (${difficulty})` : 'Self Play'}
            </Badge>
          </div>
        </div>
      </header>
  
      {/* Game Board */}
      <main className="pt-16 h-full">
        <div className="h-full w-full p-4">
          <GameBoard
            players={sortedPlayers}
            playerCount={gameState.playerCount as PlayerCount}
            currentTurnIndex={currentTurnIndex}
            onCardClick={handleCardClick}
            onZoneClick={handleZoneClick}
            onConcede={handleConcede}
            onOfferDraw={handleOfferDraw}
            onAcceptDraw={handleAcceptDraw}
            onDeclineDraw={handleDeclineDraw}
          />
        </div>
      </main>
  
      {/* Game Controls Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3" />
              {playerName}: {uiPlayers.find(p => p.name === playerName)?.lifeTotal || 20}
            </span>
            {uiPlayers.find(p => p.name !== playerName) && (
              <span className="flex items-center gap-1">
                <Heart className="w-3 h-3" />
                {uiPlayers.find(p => p.name !== playerName)?.name}: {uiPlayers.find(p => p.name !== playerName)?.lifeTotal || 20}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {/* Self-play controls */}
            {mode === 'self-play' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePassPriority}
                  disabled={!isPlayerTurn || isGameEnded}
                >
                  <SkipForward className="w-3 h-3 mr-1" />
                  Pass Priority
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAdvancePhase}
                  disabled={isGameEnded}
                >
                  <Play className="w-3 h-3 mr-1" />
                  Advance Phase
                </Button>
              </>
            )}
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleConcede}
              disabled={isGameEnded}
            >
              Concede
            </Button>
            
            <Button
              variant={autoSaveEnabled ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
              title={autoSaveEnabled ? 'Auto-save enabled' : 'Auto-save disabled'}
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
                  title: 'Game State',
                  description: `Turn ${gameState.turn.turnNumber}, Phase: ${gameState.turn.currentPhase}, Status: ${gameState.status}`,
                });
              }}
            >
              <Info className="w-3 h-3" />
            </Button>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>
              {gameState.status === 'completed' ? 'Game Ended' : 'Game in Progress'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function GameLoading() {
  return (
    <div className="flex-1 p-4 md:p-6 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardContent className="p-6 text-center space-y-4">
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded"></div>
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
          <p className="text-muted-foreground">Loading game...</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GamePage() {
  return (
    <Suspense fallback={<GameLoading />}>
      <GameBoardContent />
    </Suspense>
  );
}
