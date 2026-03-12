/**
 * AI vs AI Spectator Mode
 * 
 * Watch two AI opponents play against each other with play-by-play commentary.
 * Educational and entertaining feature for learning AI strategies.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

// Import spectator components
import { SpectatorControls, type GameSpeed, SPEED_CONFIG } from './_components/spectator-controls';
import { CommentaryPanel } from './_components/commentary-panel';
import { AIPlayerView } from './_components/ai-player-view';

// Import game state and AI
import {
  createInitialGameState,
  startGame,
  loadDeckForPlayer,
  type GameState,
  type Player,
} from '@/lib/game-state';
import { runAITurn } from '@/ai/ai-turn-loop';
import { SpectatorCommentary, CommentaryHistory, type CommentaryEntry } from '@/ai/spectator-commentary';
import { useToast } from '@/hooks/use-toast';

/**
 * Generate a simple deck for AI vs AI games
 */
function generateSimpleDeck() {
  const deck: any[] = [];

  // 24 basic lands
  const BASIC_LANDS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  for (let i = 0; i < 24; i++) {
    const landName = BASIC_LANDS[i % 5];
    deck.push({
      id: `land-${i}-${Date.now()}`,
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
    });
  }

  // 36 creature spells (simple bears)
  for (let i = 0; i < 36; i++) {
    const isGrizzly = i % 2 === 0;
    deck.push({
      id: `creature-${i}-${Date.now()}`,
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
    });
  }

  return deck;
}

export default function SpectatorPage() {
  const router = useRouter();
  const { toast } = useToast();

  // Game state
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [speed, setSpeed] = useState<GameSpeed>('normal');
  const [currentTurnPlayerId, setCurrentTurnPlayerId] = useState<string | null>(null);

  // Commentary
  const [commentary, setCommentary] = useState<CommentaryEntry[]>([]);
  const commentaryHistoryRef = useRef<CommentaryHistory>(new CommentaryHistory(50));

  // AI names
  const PLAYER_1_NAME = 'AI Aggro';
  const PLAYER_2_NAME = 'AI Control';

  // Initialize game
  const initializeGame = useCallback(() => {
    try {
      // Create initial game state with two AI players
      const state = createInitialGameState([PLAYER_1_NAME, PLAYER_2_NAME], 20, false);

      // Generate and load decks for both players
      const player1Deck = generateSimpleDeck();
      const player2Deck = generateSimpleDeck();

      const players = Array.from(state.players.values());
      let updatedState = loadDeckForPlayer(state, players[0].id, player1Deck);
      updatedState = loadDeckForPlayer(updatedState, players[1].id, player2Deck);

      // Start the game (draw opening hands)
      updatedState = startGame(updatedState);
      updatedState.status = 'in_progress';

      setGameState(updatedState);
      setIsGameStarted(true);
      setIsPlaying(false); // Start paused
      setCurrentTurnPlayerId(updatedState.turn.activePlayerId);

      // Initialize commentary
      commentaryHistoryRef.current.clear();
      const initialCommentary = new SpectatorCommentary(updatedState);
      commentaryHistoryRef.current.add(
        initialCommentary.generateMessage('⚔️ AI vs AI Spectator Mode initialized')
      );
      commentaryHistoryRef.current.add(
        initialCommentary.generateMessage(`${PLAYER_1_NAME} vs ${PLAYER_2_NAME}`)
      );
      setCommentary([...commentaryHistoryRef.current.getAll()]);

      toast({
        title: 'Game Ready',
        description: 'Press Start to begin the match',
      });
    } catch (error) {
      console.error('Failed to initialize game:', error);
      toast({
        title: 'Error',
        description: 'Failed to initialize game state',
        variant: 'destructive',
      });
    }
  }, [toast]);

  // Add commentary entry
  const addCommentary = useCallback((entry: CommentaryEntry) => {
    commentaryHistoryRef.current.add(entry);
    setCommentary([...commentaryHistoryRef.current.getAll()]);
  }, []);

  // Export game history
  const exportGameHistory = useCallback(() => {
    const history = commentaryHistoryRef.current.exportAsText();
    const blob = new Blob([history], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-game-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: 'Export Complete',
      description: 'Game history downloaded',
    });
  }, [toast]);

  // Run AI turn with commentary
  const runTurnWithCommentary = useCallback(async (state: GameState) => {
    const currentPlayerId = state.turn.activePlayerId;
    const currentPlayer = state.players.get(currentPlayerId);

    if (!currentPlayer) return;

    // Generate turn start commentary
    const commentary_gen = new SpectatorCommentary(state);
    addCommentary(commentary_gen.generateTurnStart(currentPlayerId));

    try {
      // Run AI turn with commentary callback
      const result = await runAITurn(
        state,
        currentPlayerId,
        {
          difficulty: 'medium',
          delayMs: SPEED_CONFIG[speed].delay,
          onCommentary: (text: string) => {
            addCommentary(commentary_gen.generateMessage(text));
          },
        }
      );

      if (result.success && result.finalState) {
        setGameState({ ...result.finalState });
        setCurrentTurnPlayerId(result.finalState.turn.activePlayerId);
      }
    } catch (error) {
      console.error('AI turn error:', error);
      addCommentary(commentary_gen.generateMessage(`Error during ${currentPlayer.name}'s turn`));
    }
  }, [speed, addCommentary]);

  // Game loop effect
  useEffect(() => {
    if (!isPlaying || !gameState || gameState.status !== 'in_progress') return;

    // Check for game over
    if (gameState.winners.length > 0) {
      const winner = gameState.players.get(gameState.winners[0]);
      const commentary_gen = new SpectatorCommentary(gameState);
      addCommentary(commentary_gen.generateWin(gameState.winners[0], gameState.endReason || 'Victory'));
      setIsPlaying(false);
      return;
    }

    const runTurn = async () => {
      await runTurnWithCommentary(gameState);
    };

    // Schedule next turn
    const timeoutId = setTimeout(runTurn, SPEED_CONFIG[speed].delay);

    return () => clearTimeout(timeoutId);
  }, [isPlaying, gameState, speed, runTurnWithCommentary, addCommentary]);

  // Get players
  const players = gameState ? Array.from(gameState.players.values()) : [];
  const player1 = players[0];
  const player2 = players[1];

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      {/* Header */}
      <div className="mb-4">
        <Button
          variant="ghost"
          onClick={() => router.push('/dashboard')}
          className="mb-2 gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              ⚔️ AI vs AI Spectator
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Watch two AI opponents battle it out with play-by-play commentary
            </p>
          </div>

          {gameState && (
            <Badge variant="outline" className="text-sm">
              Turn {gameState.turn.turnNumber}
            </Badge>
          )}
        </div>
      </div>

      {/* Controls */}
      <SpectatorControls
        isPlaying={isPlaying}
        isGameStarted={isGameStarted}
        speed={speed}
        onStart={() => {
          if (!isGameStarted) {
            initializeGame();
          } else {
            setIsPlaying(true);
            toast({
              title: 'Game Resumed',
              description: 'Spectator mode continuing',
            });
          }
        }}
        onPause={() => {
          setIsPlaying(false);
          toast({
            title: 'Game Paused',
            description: 'Spectator mode paused',
          });
        }}
        onRestart={() => {
          setIsPlaying(false);
          initializeGame();
          toast({
            title: 'Game Restarted',
            description: 'New game initialized',
          });
        }}
        onSpeedChange={setSpeed}
        onExport={exportGameHistory}
      />

      {/* Game Over Alert */}
      {gameState?.status === 'completed' && gameState.winners.length > 0 && (
        <Alert className="mb-4 bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border-yellow-500">
          <AlertDescription className="flex items-center gap-2">
            <span className="text-2xl">🏆</span>
            <div>
              <span className="font-bold">
                {gameState.players.get(gameState.winners[0])?.name} wins!
              </span>
              <span className="text-muted-foreground ml-2">
                ({gameState.endReason})
              </span>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column - Player Views */}
        <div className="lg:col-span-2 space-y-4">
          {/* Opponent (Top) */}
          <AIPlayerView
            player={player2}
            gameState={gameState}
            isOpponent={true}
            isActiveTurn={gameState?.turn.activePlayerId === player2?.id}
          />

          {/* Commentary Panel */}
          <CommentaryPanel commentary={commentary} />

          {/* Player (Bottom) */}
          <AIPlayerView
            player={player1}
            gameState={gameState}
            isOpponent={false}
            isActiveTurn={gameState?.turn.activePlayerId === player1?.id}
          />
        </div>

        {/* Right Column - Game Info */}
        <div className="space-y-4">
          {/* Game Status Card */}
          <div className="p-4 border rounded-lg bg-card">
            <h3 className="font-semibold mb-3">Game Status</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className={gameState?.status === 'in_progress' ? 'text-green-500' : ''}>
                  {gameState?.status || 'Not Started'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Turn:</span>
                <span>{gameState?.turn.turnNumber || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phase:</span>
                <span className="capitalize">{gameState?.turn.currentPhase?.replace(/_/g, ' ') || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Speed:</span>
                <span>{SPEED_CONFIG[speed].label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Commentary:</span>
                <span>{commentary.length} entries</span>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="p-4 border rounded-lg bg-card">
            <h3 className="font-semibold mb-3">How to Use</h3>
            <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
              <li>Click <strong>Start</strong> to begin the match</li>
              <li>Watch AI players battle automatically</li>
              <li>Read commentary for play-by-play action</li>
              <li>Adjust speed for faster/slower gameplay</li>
              <li>Use <strong>Export</strong> to save game history</li>
              <li>Click <strong>Restart</strong> for a new game</li>
            </ul>
          </div>

          {/* Speed Info */}
          <div className="p-4 border rounded-lg bg-card">
            <h3 className="font-semibold mb-3">Speed Settings</h3>
            <div className="space-y-2 text-sm">
              {Object.entries(SPEED_CONFIG).map(([value, config]) => (
                <div
                  key={value}
                  className={`flex items-center gap-2 p-2 rounded ${speed === value ? 'bg-muted' : ''}`}
                >
                  {config.icon}
                  <div className="flex-1">
                    <div className="font-medium">{config.label}</div>
                    <div className="text-xs text-muted-foreground">{config.description}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{config.delay}ms</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
