# Plan 3.5: AI vs AI Spectator Mode

## Objective
Implement spectator mode to watch two AI opponents play against each other with play-by-play commentary.

## Why This Matters
- Users can observe AI strategies for learning (REQ-5.5 stretch)
- Demonstrates AI capabilities
- Entertaining and educational
- Low-risk feature (doesn't block core functionality)

---

## Tasks

### Task 3.5.1: Design Spectator UI
**Type**: research
**Duration**: ~30 min

**Actions**:
1. Review existing game board UI:
   - `src/app/(app)/game/[id]/page.tsx`
   - Current player vs AI layout

2. Design spectator layout:
   ```
   ┌─────────────────────────────────────────────────┐
   │  ⚔️ AI vs AI Spectator              [Speed: 1x ▼]│
   ├─────────────────────────────────────────────────┤
   │  ┌─────────────────────────────────────────┐   │
   │  │         Opponent AI (Control)            │   │
   │  │  Life: 20  Mana: 🟦🟦🟦  Hand: 7         │   │
   │  │  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐         │   │
   │  │  │   │ │   │ │   │ │   │ │   │  ...     │   │
   │  │  └───┘ └───┘ └───┘ └───┘ └───┘         │   │
   │  └─────────────────────────────────────────┘   │
   │                                                 │
   │  ┌─────────────────────────────────────────┐   │
   │  │              Commentary                  │   │
   │  │  "Player AI casts Lightning Bolt        │   │
   │  │   targeting Opponent AI's Grizzly Bears" │   │
   │  └─────────────────────────────────────────┘   │
   │                                                 │
   │  ┌─────────────────────────────────────────┐   │
   │  │         Player AI (Aggro)                │   │
   │  │  Life: 20  Mana: 🟥🟥  Hand: 6           │   │
   │  │  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐         │   │
   │  │  │   │ │   │ │   │ │   │ │   │  ...     │   │
   │  │  └───┘ └───┘ └───┘ └───┘ └───┘         │   │
   │  └─────────────────────────────────────────┘   │
   │                                                 │
   │  [Start] [Pause] [Restart] [Export]            │
   └─────────────────────────────────────────────────┘
   ```

3. Identify required components:
   - Speed control dropdown
   - Commentary panel
   - Control buttons (Start, Pause, Restart, Export)
   - Dual AI player view

**Deliverable**: UI mockup and component list

---

### Task 3.5.2: Create Spectator Page
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Create `src/app/(app)/spectator/page.tsx`:
```typescript
'use client';

import { useState, useEffect } from 'react';
import { SpectatorControls } from './_components/spectator-controls';
import { CommentaryPanel } from './_components/commentary-panel';
import { AIPlayerView } from './_components/ai-player-view';
import { createInitialGameState } from '@/lib/game-state/game-state';
import { runAITurn } from '@/ai/ai-turn-loop';

type GameSpeed = 'instant' | 'fast' | 'normal';

const SPEED_DELAYS = {
  instant: 100,
  fast: 500,
  normal: 2000,
};

export default function SpectatorPage() {
  const [gameState, setGameState] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<GameSpeed>('normal');
  const [commentary, setCommentary] = useState<string[]>([]);

  const startGame = () => {
    const state = createInitialGameState(['Player AI', 'Opponent AI']);
    setGameState(state);
    setIsPlaying(true);
    addCommentary('Game started! Player AI vs Opponent AI');
  };

  const addCommentary = (text: string) => {
    setCommentary(prev => [text, ...prev].slice(0, 10));
  };

  useEffect(() => {
    if (!isPlaying || !gameState) return;

    const runTurn = async () => {
      const currentPlayerId = gameState.turn.activePlayerId;
      addCommentary(`${currentPlayerId}'s turn begins`);

      await runAITurn(gameState, currentPlayerId);

      setGameState(prev => ({ ...prev }));
    };

    const timeoutId = setTimeout(runTurn, SPEED_DELAYS[speed]);

    return () => clearTimeout(timeoutId);
  }, [isPlaying, gameState, speed]);

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">⚔️ AI vs AI Spectator</h1>

      <SpectatorControls
        isPlaying={isPlaying}
        speed={speed}
        onStart={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onRestart={startGame}
        onSpeedChange={setSpeed}
      />

      <AIPlayerView
        player={gameState?.players.get('player-1')}
        isOpponent={true}
      />

      <CommentaryPanel commentary={commentary} />

      <AIPlayerView
        player={gameState?.players.get('player-2')}
        isOpponent={false}
      />
    </div>
  );
}
```

**Verification**:
- Page renders without errors
- TypeScript compiles

---

### Task 3.5.3: Create Spectator Controls Component
**Type**: auto
**Duration**: ~45 min

**Actions**:
1. Create `src/app/(app)/spectator/_components/spectator-controls.tsx`:
```typescript
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SpectatorControlsProps {
  isPlaying: boolean;
  speed: 'instant' | 'fast' | 'normal';
  onStart: () => void;
  onPause: () => void;
  onRestart: () => void;
  onSpeedChange: (speed: 'instant' | 'fast' | 'normal') => void;
}

export function SpectatorControls({
  isPlaying,
  speed,
  onStart,
  onPause,
  onRestart,
  onSpeedChange,
}: SpectatorControlsProps) {
  return (
    <div className="flex items-center gap-4 mb-4 p-4 bg-muted rounded-lg">
      <div className="flex gap-2">
        {!isPlaying ? (
          <Button onClick={onStart}>▶ Start</Button>
        ) : (
          <Button onClick={onPause} variant="secondary">
            ⏸ Pause
          </Button>
        )}
        <Button onClick={onRestart} variant="outline">
          🔄 Restart
        </Button>
      </div>

      <div className="ml-auto">
        <Select value={speed} onValueChange={onSpeedChange}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="instant">⚡ Instant</SelectItem>
            <SelectItem value="fast">⏩ Fast</SelectItem>
            <SelectItem value="normal">▶ Normal</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

**Verification**:
- Controls render correctly
- Speed selector works
- Buttons trigger callbacks

---

### Task 3.5.4: Create Commentary Panel Component
**Type**: auto
**Duration**: ~45 min

**Actions**:
1. Create `src/app/(app)/spectator/_components/commentary-panel.tsx`:
```typescript
import { ScrollArea } from '@/components/ui/scroll-area';

interface CommentaryPanelProps {
  commentary: string[];
}

export function CommentaryPanel({ commentary }: CommentaryPanelProps) {
  return (
    <div className="mb-4 p-4 border rounded-lg bg-card">
      <h3 className="text-lg font-semibold mb-2">📢 Commentary</h3>
      <ScrollArea className="h-[200px]">
        <div className="space-y-2">
          {commentary.map((line, index) => (
            <div
              key={index}
              className={`text-sm ${index === 0 ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
            >
              {index === 0 ? '→ ' : '  '}
              {line}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
```

**Verification**:
- Commentary displays in order
- Latest commentary highlighted
- Scroll works for long lists

---

### Task 3.5.5: Create AI Player View Component
**Type**: auto
**Duration**: ~45 min

**Actions**:
1. Create `src/app/(app)/spectator/_components/ai-player-view.tsx`:
```typescript
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface AIPlayerViewProps {
  player: any; // Player state
  isOpponent: boolean;
}

export function AIPlayerView({ player, isOpponent }: AIPlayerViewProps) {
  if (!player) return null;

  const manaSymbols = {
    white: '⬜',
    blue: '🟦',
    black: '⬛',
    red: '🟥',
    green: '🟩',
    colorless: '⚪',
  };

  return (
    <Card className={`p-4 mb-4 ${isOpponent ? 'border-red-500' : 'border-blue-500'}`}>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-bold">
          {isOpponent ? '🔴' : '🔵'} {player.name}
        </h3>
        <div className="text-sm text-muted-foreground">
          Life: {player.life} | Poison: {player.poisonCounters}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-sm text-muted-foreground mb-1">Mana Pool</div>
          <div className="flex gap-1">
            {Object.entries(player.manaPool)
              .filter(([_, count]) => count > 0)
              .map(([color, count]) => (
                <span key={color} title={color}>
                  {manaSymbols[color as keyof typeof manaSymbols]?.repeat(count as number)}
                </span>
              ))}
          </div>
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-1">
            Hand: {player.hand?.length || 0} cards
          </div>
          <Progress value={(player.hand?.length || 0) / 10 * 100} className="h-2" />
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-1">
            Battlefield: {player.battlefield?.length || 0} permanents
          </div>
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-1">
            Library: {player.library || 0} cards
          </div>
        </div>
      </div>
    </Card>
  );
}
```

**Verification**:
- Player stats display correctly
- Mana symbols render
- Battlefield count updates

---

### Task 3.5.6: Implement Commentary System
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Create `src/ai/spectator-commentary.ts`:
```typescript
import type { GameState, CardInstance, PlayerId } from '@/lib/game-state/types';

export class SpectatorCommentary {
  private gameState: GameState;

  constructor(gameState: GameState) {
    this.gameState = gameState;
  }

  generateTurnStart(playerId: PlayerId): string {
    const player = this.gameState.players.get(playerId);
    return `${player?.name}'s turn begins (Turn ${this.gameState.turn.number})`;
  }

  generateLandPlay(playerId: PlayerId, land: CardInstance): string {
    const player = this.gameState.players.get(playerId);
    return `${player?.name} plays ${land.cardDefinition.name}`;
  }

  generateSpellCast(playerId: PlayerId, spell: CardInstance, target?: string): string {
    const player = this.gameState.players.get(playerId);
    if (target) {
      return `${player?.name} casts ${spell.cardDefinition.name} targeting ${target}`;
    }
    return `${player?.name} casts ${spell.cardDefinition.name}`;
  }

  generateAttack(playerId: PlayerId, attackerCount: number): string {
    const player = this.gameState.players.get(playerId);
    const creatures = attackerCount === 1 ? 'creature' : 'creatures';
    return `${player?.name} attacks with ${attackerCount} ${creatures}`;
  }

  generateBlock(playerId: PlayerId, blockerCount: number): string {
    const player = this.gameState.players.get(playerId);
    const creatures = blockerCount === 1 ? 'creature' : 'creatures';
    return `${player?.name} blocks with ${blockerCount} ${creatures}`;
  }

  generateDamage(source: string, target: string, amount: number): string {
    return `${source} deals ${amount} damage to ${target}`;
  }

  generateLifeChange(playerId: PlayerId, oldLife: number, newLife: number): string {
    const player = this.gameState.players.get(playerId);
    const diff = newLife - oldLife;
    const sign = diff > 0 ? '+' : '';
    return `${player?.name} goes from ${oldLife} to ${newLife} life (${sign}${diff})`;
  }

  generateWin(playerId: PlayerId, reason: string): string {
    const player = this.gameState.players.get(playerId);
    return `🏆 ${player?.name} wins! (${reason})`;
  }
}
```

2. Integrate commentary into AI turn loop:
```typescript
// In ai-turn-loop.ts
import { SpectatorCommentary } from './spectator-commentary';

export async function runAITurn(
  gameState: GameState,
  playerId: PlayerId,
  onCommentary?: (text: string) => void
) {
  const commentary = new SpectatorCommentary(gameState);

  if (onCommentary) {
    onCommentary(commentary.generateTurnStart(playerId));
  }

  // ... rest of turn logic
  // Call onCommentary for each action
}
```

**Verification**:
- Commentary generates for each action
- Text is clear and informative
- No errors during generation

---

### Task 3.5.7: Add Export Game History
**Type**: auto
**Duration**: ~30 min

**Actions**:
1. Add export function to spectator page:
```typescript
const exportGameHistory = () => {
  const history = commentary.join('\n');
  const blob = new Blob([history], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-game-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};
```

2. Add export button to controls:
```typescript
<Button onClick={exportGameHistory} variant="outline">
  📥 Export
</Button>
```

**Verification**:
- Export downloads text file
- File contains full commentary
- Filename includes timestamp

---

### Task 3.5.8: Integration Testing
**Type**: checkpoint:human-verify
**Duration**: ~30 min

**What Built**: AI vs AI spectator mode

**How to Verify**:
1. Navigate to `/spectator`
2. Click "Start"
3. Verify:
   - Game initializes with two AI players
   - AI takes turns automatically
   - Commentary updates each action
   - Speed control changes game speed
   - Pause/Resume works
   - Export downloads game history
4. Test each speed setting:
   - Instant: ~100ms per action
   - Fast: ~500ms per action
   - Normal: ~2000ms per action
5. Watch full game complete

**Resume Signal**: "Spectator mode working" or describe issues

---

## Success Criteria

✅ Spectator page accessible at `/spectator`
✅ Two AI opponents play full game
✅ Commentary updates for each action
✅ Speed control works (instant/fast/normal)
✅ Pause/Resume functionality works
✅ Export downloads game history
✅ No crashes during spectator mode

---

## Dependencies

- Requires: Phase 2 complete (AI turn loop working)
- Unblocks: Phase 3 complete (stretch goal done)

---

## Risks

| Risk | Mitigation |
|------|------------|
| AI turns too slow at normal speed | Adjust delay constants |
| Commentary too verbose | Limit to key actions |
| Memory issues with long games | Limit commentary history |
| Export format unclear | Add header with metadata |

---

**Created**: 2026-03-12
**Estimated Duration**: 4-6 hours
