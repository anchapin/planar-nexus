/**
 * Game Board Client Component
 * Contains all the client-side game logic
 * This is loaded by the server component
 */

'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, RotateCcw, Play, SkipForward } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface GameBoardClientProps {
  gameId: string;
}

// AI decision types
type AIDecision = 
  | { type: 'play_land'; cardId: string }
  | { type: 'play_creature'; cardId: string; manaCost: number }
  | { type: 'play_instant'; cardId: string; manaCost: number }
  | { type: 'activate_ability'; abilityIndex: number; targetId?: string }
  | { type: 'attack'; data: { attackers: string[]; defenderId?: string } }
  | { type: 'pass' };

interface AttackDecisionData {
  attackers: string[];
  defenderId?: string;
}

export function GameBoardClient({ gameId }: GameBoardClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const [gameState, setGameState] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [targetMode, setTargetMode] = useState<{ sourceId: string; type: 'attack' | 'ability' } | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [showDeckOrder, setShowDeckOrder] = useState(false);
  const [mulliganChoice, setMulliganChoice] = useState<number | null>(null);
  const [handIndicesToMulligan, setHandIndicesToMulligan] = useState<number[]>([]);
  
  const playerName = 'Player 1';
  const aiPlayerName = 'AI Opponent';
  
  // Load saved game on mount
  useEffect(() => {
    const loadGame = async () => {
      try {
        setIsLoading(true);
        
        // For now, create a simple placeholder game state
        // Full game implementation would load from saved games
        const newState = {
          players: new Map([
            [playerName, { 
              name: playerName, 
              life: 20, 
              hand: [], 
              battlefield: [], 
              graveyard: [], 
              library: [], 
              manaPool: { red: 0, green: 0, blue: 0, black: 0, white: 0, colorless: 0 },
              isAI: false
            }],
            [aiPlayerName, { 
              name: aiPlayerName, 
              life: 20, 
              hand: [], 
              battlefield: [], 
              graveyard: [], 
              library: [], 
              manaPool: { red: 0, green: 0, blue: 0, black: 0, white: 0, colorless: 0 },
              isAI: true
            }]
          ]),
          turn: {
            turnNumber: 1,
            activePlayer: playerName,
            currentPhase: 'main1' as any,
            priorityPlayer: playerName,
            step: 'begin'
          }
        };
        
        setGameState(newState);
        toast({
          title: 'New Game Started',
          description: 'You have been dealt 7 cards. Good luck!',
        });
      } catch (err) {
        console.error('Failed to load game:', err);
        setError('Failed to load game');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadGame();
  }, [gameId, toast, playerName, aiPlayerName]);
  
  // Handle card click
  const handleCardClick = useCallback(async (cardId: string, zone: string) => {
    if (!gameState) return;
    
    if (targetMode) {
      setTargetMode(null);
      return;
    }
    
    if (zone === 'hand' || zone === 'battlefield') {
      setSelectedCard(cardId);
    }
  }, [gameState, targetMode]);
  
  // Handle zone click
  const handleZoneClick = useCallback(async (zone: string, playerId: string) => {
    // Placeholder - would handle playing cards to battlefield
  }, [gameState, selectedCard, playerName, gameId]);
  
  // Handle attack
  const handleAttack = useCallback(async (attackerId: string, defenderId: string) => {
    // Placeholder - would handle combat
  }, [gameState, gameId]);
  
  // Pass priority/action
  const handlePass = useCallback(async () => {
    // Placeholder - would handle priority passing
  }, [gameState, playerName, gameId]);
  
  // AI Turn
  const runAITurn = useCallback(async () => {
    if (!gameState || aiThinking) return;
    
    setAiThinking(true);
    
    // Simulate AI thinking
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    toast({
      title: 'AI Action',
      description: 'AI opponent passed priority',
    });
    
    setAiThinking(false);
  }, [gameState, aiThinking, aiPlayerName, gameId, toast]);
  
  // Start new game
  const handleNewGame = useCallback(() => {
    const newState = {
      players: new Map([
        [playerName, { 
          name: playerName, 
          life: 20, 
          hand: [], 
          battlefield: [], 
          graveyard: [], 
          library: [], 
          manaPool: { red: 0, green: 0, blue: 0, black: 0, white: 0, colorless: 0 },
          isAI: false
        }],
        [aiPlayerName, { 
          name: aiPlayerName, 
          life: 20, 
          hand: [], 
          battlefield: [], 
          graveyard: [], 
          library: [], 
          manaPool: { red: 0, green: 0, blue: 0, black: 0, white: 0, colorless: 0 },
          isAI: true
        }]
      ]),
      turn: {
        turnNumber: 1,
        activePlayer: playerName,
        currentPhase: 'main1' as any,
        priorityPlayer: playerName,
        step: 'begin'
      }
    };
    
    setGameState(newState);
    setSelectedCard(null);
    setError(null);
    
    toast({
      title: 'New Game Started',
      description: 'You have been dealt 7 cards. Good luck!',
    });
  }, [toast, playerName, aiPlayerName]);
  
  // Render loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading game...</p>
        </div>
      </div>
    );
  }
  
  // Render error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{error}</AlertDescription>
          <Button variant="outline" onClick={handleNewGame} className="mt-4">
            Start New Game
          </Button>
        </Alert>
      </div>
    );
  }
  
  if (!gameState) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">No game state</p>
      </div>
    );
  }
  
  const playerNames = Array.from(gameState.players.keys());
  const currentPlayerName = playerNames[0] || playerName;
  const isPlayerTurn = true; // Simplified for now
  const currentPlayer = { manaPool: { red: 0, green: 0, blue: 0, black: 0, white: 0, colorless: 0 } };
  
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Game Board</h1>
          <Badge variant="outline">Game {gameId.slice(0, 8)}</Badge>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleNewGame}>
            <RotateCcw className="h-4 w-4 mr-2" />
            New Game
          </Button>
        </div>
      </div>
      
      {/* Game Info Bar */}
      <div className="bg-muted/50 p-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <span className="font-medium">
            Turn {gameState.turn.turnNumber}
          </span>
          <span className="text-muted-foreground">|</span>
          <span>
            Phase: <span className="font-medium capitalize">{gameState.turn.currentPhase.replace('_', ' ')}</span>
          </span>
          <span className="text-muted-foreground">|</span>
          <span>
            Active: <span className="font-medium">{gameState.turn.activePlayer}</span>
          </span>
        </div>
        
        {aiThinking && (
          <span className="text-amber-600 flex items-center gap-2">
            <span className="animate-pulse">AI is thinking...</span>
          </span>
        )}
      </div>
      
      {/* Main Game Area */}
      <div className="p-4">
        {/* Simplified game display */}
        <div className="bg-card rounded-lg p-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Game Board</h2>
            <p className="text-muted-foreground mb-4">Turn {gameState?.turn?.turnNumber || 1}</p>
            <p className="text-muted-foreground">Phase: {gameState?.turn?.currentPhase || 'main1'}</p>
          </div>
        </div>
      </div>
      
      {/* Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            {currentPlayer && (
              <>
                <span className="text-sm text-muted-foreground">
                  {currentPlayer.manaPool.green + currentPlayer.manaPool.blue + currentPlayer.manaPool.red + currentPlayer.manaPool.black + currentPlayer.manaPool.white + currentPlayer.manaPool.colorless} / {currentPlayer.manaPool.green + currentPlayer.manaPool.blue + currentPlayer.manaPool.red + currentPlayer.manaPool.black + currentPlayer.manaPool.white + currentPlayer.manaPool.colorless + currentPlayer.manaPool.green + currentPlayer.manaPool.blue + currentPlayer.manaPool.red + currentPlayer.manaPool.black + currentPlayer.manaPool.white + currentPlayer.manaPool.colorless} Mana
                </span>
              </>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {isPlayerTurn && (
              <>
                <Button onClick={handlePass} disabled={aiThinking}>
                  <SkipForward className="h-4 w-4 mr-2" />
                  Pass Priority
                </Button>
                <Button onClick={runAITurn} variant="secondary" disabled={aiThinking}>
                  <Play className="h-4 w-4 mr-2" />
                  End Turn
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
