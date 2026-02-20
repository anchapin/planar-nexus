'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Gavel, 
  Users, 
  Shield, 
  Heart, 
  Skull, 
  RotateCcw, 
  AlertTriangle, 
  Eye, 
  Settings,
  Plus,
  Minus,
  Check,
  X,
  Pause,
  Play,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Judge role types
export type JudgeRole = 'judge' | 'head-judge' | 'spectator-privileged';

// Warning/Penalty types
export type PenaltyType = 'warning' | 'game-loss' | 'match-loss' | 'disqualification';

export interface Warning {
  id: string;
  playerId: string;
  playerName: string;
  type: PenaltyType;
  reason: string;
  round: number;
  timestamp: number;
  issuedBy: string;
}

// Player state for judge intervention
export interface JudgePlayerState {
  id: string;
  name: string;
  life: number;
  poisonCounters: number;
  energyCounters: number;
  isActive: boolean;
}

// Game state for inspection
export interface JudgeGameState {
  turn: number;
  phase: string;
  step: string;
  activePlayerId: string;
  priorityPlayerId: string;
  players: JudgePlayerState[];
}

// Judge tools configuration
export interface JudgeToolsConfig {
  enabled: boolean;
  role: JudgeRole;
  canModifyLife: boolean;
  canModifyCounters: boolean;
  canUndoActions: boolean;
  canIssuePenalties: boolean;
  canPauseGame: boolean;
}

// Default judge configuration
export const DEFAULT_JUDGE_CONFIG: JudgeToolsConfig = {
  enabled: false,
  role: 'judge',
  canModifyLife: true,
  canModifyCounters: true,
  canUndoActions: true,
  canIssuePenalties: true,
  canPauseGame: true,
};

// Warning/Penalty display component
interface PenaltyBadgeProps {
  type: PenaltyType;
}

export function PenaltyBadge({ type }: PenaltyBadgeProps) {
  const getConfig = () => {
    switch (type) {
      case 'warning':
        return { color: 'bg-yellow-500', label: 'Warning' };
      case 'game-loss':
        return { color: 'bg-orange-500', label: 'Game Loss' };
      case 'match-loss':
        return { color: 'bg-red-500', label: 'Match Loss' };
      case 'disqualification':
        return { color: 'bg-purple-500', label: 'DQ' };
      default:
        return { color: 'bg-gray-500', label: type };
    }
  };

  const config = getConfig();

  return (
    <Badge className={cn('text-white', config.color)}>
      {config.label}
    </Badge>
  );
}

// Warning log component
interface WarningLogProps {
  warnings: Warning[];
  onDismiss?: (warningId: string) => void;
  className?: string;
}

export function WarningLog({ warnings, onDismiss, className }: WarningLogProps) {
  const sortedWarnings = [...warnings].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-500" />
          Warning Log
        </CardTitle>
        <CardDescription>
          Track issued warnings and penalties
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sortedWarnings.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No warnings issued yet.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {sortedWarnings.map((warning) => (
              <div
                key={warning.id}
                className="flex items-center justify-between p-2 rounded bg-muted"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{warning.playerName}</span>
                    <PenaltyBadge type={warning.type} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {warning.reason} (Round {warning.round})
                  </p>
                </div>
                {onDismiss && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDismiss(warning.id)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Life adjustment component
interface LifeAdjustmentProps {
  player: JudgePlayerState;
  onAdjust: (playerId: string, amount: number) => void;
  disabled?: boolean;
}

export function LifeAdjustment({ player, onAdjust, disabled }: LifeAdjustmentProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={() => onAdjust(player.id, -1)}
        disabled={disabled || player.life <= 0}
        className="h-8 w-8"
      >
        <Minus className="w-3 h-3" />
      </Button>
      <div className="flex items-center gap-1 min-w-[60px] justify-center">
        <Heart className={cn(
          'w-4 h-4',
          player.life > 10 ? 'text-green-500' : player.life > 5 ? 'text-yellow-500' : 'text-red-500'
        )} />
        <span className="font-bold text-lg w-8 text-center">{player.life}</span>
      </div>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onAdjust(player.id, 1)}
        disabled={disabled}
        className="h-8 w-8"
      >
        <Plus className="w-3 h-3" />
      </Button>
      {/* Quick adjustments */}
      <div className="flex gap-1 ml-2">
        {[5, 10, -5, -10].map((amount) => (
          <Button
            key={amount}
            variant="outline"
            size="sm"
            onClick={() => onAdjust(player.id, amount)}
            disabled={disabled || (player.life + amount <= 0 && amount < 0)}
            className="h-7 text-xs"
          >
            {amount > 0 ? '+' : ''}{amount}
          </Button>
        ))}
      </div>
    </div>
  );
}

// Counter adjustment component
interface CounterAdjustmentProps {
  player: JudgePlayerState;
  counterType: 'poison' | 'energy';
  onAdjust: (playerId: string, counterType: 'poison' | 'energy', amount: number) => void;
  disabled?: boolean;
}

export function CounterAdjustment({ player, counterType, onAdjust, disabled }: CounterAdjustmentProps) {
  const value = counterType === 'poison' ? player.poisonCounters : player.energyCounters;
  const icon = counterType === 'poison' ? <Skull className="w-4 h-4 text-purple-500" /> : <Zap className="w-4 h-4 text-yellow-500" />;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={() => onAdjust(player.id, counterType, -1)}
        disabled={disabled || value <= 0}
        className="h-8 w-8"
      >
        <Minus className="w-3 h-3" />
      </Button>
      <div className="flex items-center gap-1 min-w-[40px] justify-center">
        {icon}
        <span className="font-bold text-sm w-4 text-center">{value}</span>
      </div>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onAdjust(player.id, counterType, 1)}
        disabled={disabled}
        className="h-8 w-8"
      >
        <Plus className="w-3 h-3" />
      </Button>
    </div>
  );
}

// Game state inspector component
interface GameStateInspectorProps {
  gameState: JudgeGameState;
  className?: string;
}

export function GameStateInspector({ gameState, className }: GameStateInspectorProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="w-5 h-5" />
          Game State Inspector
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Turn info */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Turn:</span>
            <span className="font-medium">{gameState.turn}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Phase:</span>
            <span className="font-medium">{gameState.phase}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Step:</span>
            <span className="font-medium">{gameState.step}</span>
          </div>
        </div>

        {/* Active/Priority players */}
        <div className="flex gap-2">
          <Badge variant="outline" className="bg-green-500/10">
            Active: {gameState.players.find(p => p.id === gameState.activePlayerId)?.name || 'N/A'}
          </Badge>
          <Badge variant="outline" className="bg-blue-500/10">
            Priority: {gameState.players.find(p => p.id === gameState.priorityPlayerId)?.name || 'N/A'}
          </Badge>
        </div>

        {/* Player states */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Player States:</Label>
          {gameState.players.map((player) => (
            <div
              key={player.id}
              className={cn(
                'flex items-center justify-between p-2 rounded text-sm',
                player.isActive && 'bg-green-500/10 border border-green-500/30'
              )}
            >
              <span className="font-medium">{player.name}</span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <Heart className={cn(
                    'w-3 h-3',
                    player.life > 10 ? 'text-green-500' : player.life > 5 ? 'text-yellow-500' : 'text-red-500'
                  )} />
                  <span>{player.life}</span>
                </div>
                {player.poisonCounters > 0 && (
                  <div className="flex items-center gap-1">
                    <Skull className="w-3 h-3 text-purple-500" />
                    <span>{player.poisonCounters}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Penalty issuance component
interface IssuePenaltyProps {
  players: { id: string; name: string }[];
  currentRound: number;
  judgeName: string;
  onIssuePenalty: (playerId: string, type: PenaltyType, reason: string) => void;
  disabled?: boolean;
  className?: string;
}

export function IssuePenalty({ players, currentRound, judgeName: _judgeName, onIssuePenalty, disabled, className }: IssuePenaltyProps) {
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [penaltyType, setPenaltyType] = useState<PenaltyType>('warning');
  const [reason, setReason] = useState('');

  const handleSubmit = () => {
    if (selectedPlayer && reason) {
      onIssuePenalty(selectedPlayer, penaltyType, reason);
      setSelectedPlayer('');
      setPenaltyType('warning');
      setReason('');
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="w-5 h-5" />
          Issue Penalty
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Player</Label>
          <select
            className="w-full px-3 py-2 border rounded-md"
            value={selectedPlayer}
            onChange={(e) => setSelectedPlayer(e.target.value)}
            disabled={disabled}
          >
            <option value="">Select player...</option>
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>Penalty Type</Label>
          <div className="flex flex-wrap gap-2">
            {(['warning', 'game-loss', 'match-loss', 'disqualification'] as PenaltyType[]).map((type) => (
              <Button
                key={type}
                variant={penaltyType === type ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPenaltyType(type)}
                disabled={disabled}
              >
                <PenaltyBadge type={type} />
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Reason</Label>
          <Input
            placeholder="e.g., Manual shuffle, Slow play..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled}
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={disabled || !selectedPlayer || !reason}
          className="w-full"
        >
          <Check className="w-4 h-4 mr-2" />
          Issue Penalty (Round {currentRound})
        </Button>
      </CardContent>
    </Card>
  );
}

// Main Judge Panel component
interface JudgePanelProps {
  config: JudgeToolsConfig;
  gameState: JudgeGameState;
  warnings: Warning[];
  onConfigChange: (config: JudgeToolsConfig) => void;
  onLifeAdjust: (playerId: string, amount: number) => void;
  onCounterAdjust: (playerId: string, counterType: 'poison' | 'energy', amount: number) => void;
  onUndoAction: () => void;
  onPauseGame: () => void;
  onResumeGame: () => void;
  onIssuePenalty: (playerId: string, type: PenaltyType, reason: string) => void;
  onDismissWarning: (warningId: string) => void;
  isGamePaused?: boolean;
  className?: string;
}

export function JudgePanel({
  config,
  gameState,
  warnings,
  onConfigChange,
  onLifeAdjust,
  onCounterAdjust,
  onUndoAction,
  onPauseGame,
  onResumeGame,
  onIssuePenalty,
  onDismissWarning,
  isGamePaused = false,
  className
}: JudgePanelProps) {
  if (!config.enabled) {
    return (
      <Card className={className}>
        <CardContent className="py-8 text-center">
          <Shield className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Judge tools are disabled
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => onConfigChange({ ...config, enabled: true })}
          >
            Enable Judge Mode
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs defaultValue="control" className={className}>
      <TabsList className="w-full">
        <TabsTrigger value="control" className="flex-1">Control</TabsTrigger>
        <TabsTrigger value="inspect" className="flex-1">Inspect</TabsTrigger>
        <TabsTrigger value="penalties" className="flex-1">Penalties</TabsTrigger>
        <TabsTrigger value="settings" className="flex-1">Settings</TabsTrigger>
      </TabsList>

      {/* Control Tab */}
      <TabsContent value="control" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Player Controls
              </span>
              <Badge variant="outline">{gameState.players.length} Players</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {gameState.players.map((player) => (
              <div key={player.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{player.name}</span>
                  {player.isActive && <Badge className="bg-green-500">Active</Badge>}
                </div>
                
                {config.canModifyLife && (
                  <LifeAdjustment
                    player={player}
                    onAdjust={onLifeAdjust}
                    disabled={!config.enabled}
                  />
                )}
                
                {config.canModifyCounters && (
                  <div className="flex items-center gap-4">
                    <CounterAdjustment
                      player={player}
                      counterType="poison"
                      onAdjust={onCounterAdjust}
                      disabled={!config.enabled}
                    />
                    <CounterAdjustment
                      player={player}
                      counterType="energy"
                      onAdjust={onCounterAdjust}
                      disabled={!config.enabled}
                    />
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Game control buttons */}
        <div className="flex gap-2">
          {config.canUndoActions && (
            <Button variant="outline" onClick={onUndoAction} className="flex-1">
              <RotateCcw className="w-4 h-4 mr-2" />
              Undo Last Action
            </Button>
          )}
          {config.canPauseGame && (
            <Button
              variant={isGamePaused ? 'default' : 'outline'}
              onClick={isGamePaused ? onResumeGame : onPauseGame}
              className="flex-1"
            >
              {isGamePaused ? (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Resume Game
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4 mr-2" />
                  Pause Game
                </>
              )}
            </Button>
          )}
        </div>
      </TabsContent>

      {/* Inspect Tab */}
      <TabsContent value="inspect">
        <GameStateInspector gameState={gameState} />
      </TabsContent>

      {/* Penalties Tab */}
      <TabsContent value="penalties" className="space-y-4">
        {config.canIssuePenalties && (
          <IssuePenalty
            players={gameState.players.map(p => ({ id: p.id, name: p.name }))}
            currentRound={gameState.turn}
            judgeName="Judge"
            onIssuePenalty={onIssuePenalty}
            disabled={!config.enabled}
          />
        )}
        
        <WarningLog
          warnings={warnings}
          onDismiss={onDismissWarning}
        />
      </TabsContent>

      {/* Settings Tab */}
      <TabsContent value="settings" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Judge Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Enable Judge Tools</Label>
              <Switch
                checked={config.enabled}
                onCheckedChange={(checked) => onConfigChange({ ...config, enabled: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label>Judge Role</Label>
              <div className="flex gap-2">
                {(['spectator-privileged', 'judge', 'head-judge'] as JudgeRole[]).map((role) => (
                  <Button
                    key={role}
                    variant={config.role === role ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onConfigChange({ ...config, role })}
                  >
                    {role === 'spectator-privileged' ? 'Spectator' : role === 'judge' ? 'Judge' : 'Head Judge'}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Modify Life Totals</span>
                  <Switch
                    checked={config.canModifyLife}
                    onCheckedChange={(checked) => onConfigChange({ ...config, canModifyLife: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Modify Counters</span>
                  <Switch
                    checked={config.canModifyCounters}
                    onCheckedChange={(checked) => onConfigChange({ ...config, canModifyCounters: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Undo Actions</span>
                  <Switch
                    checked={config.canUndoActions}
                    onCheckedChange={(checked) => onConfigChange({ ...config, canUndoActions: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Issue Penalties</span>
                  <Switch
                    checked={config.canIssuePenalties}
                    onCheckedChange={(checked) => onConfigChange({ ...config, canIssuePenalties: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Pause Game</span>
                  <Switch
                    checked={config.canPauseGame}
                    onCheckedChange={(checked) => onConfigChange({ ...config, canPauseGame: checked })}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Disable button */}
        <Button
          variant="destructive"
          onClick={() => onConfigChange({ ...config, enabled: false })}
          className="w-full"
        >
          <X className="w-4 h-4 mr-2" />
          Exit Judge Mode
        </Button>
      </TabsContent>
    </Tabs>
  );
}

// Hook for managing judge tools state
interface UseJudgeToolsReturn {
  config: JudgeToolsConfig;
  warnings: Warning[];
  setConfig: (config: JudgeToolsConfig) => void;
  addWarning: (playerId: string, type: PenaltyType, reason: string, round: number) => void;
  dismissWarning: (warningId: string) => void;
  clearWarnings: () => void;
}

export function useJudgeTools(): UseJudgeToolsReturn {
  const [config, setConfig] = useState<JudgeToolsConfig>(DEFAULT_JUDGE_CONFIG);
  const [warnings, setWarnings] = useState<Warning[]>([]);

  const addWarning = useCallback((playerId: string, type: PenaltyType, reason: string, round: number) => {
    const warning: Warning = {
      id: `warning-${Date.now()}`,
      playerId,
      playerName: `Player ${playerId}`, // Would be resolved from game state
      type,
      reason,
      round,
      timestamp: Date.now(),
      issuedBy: 'Judge',
    };
    setWarnings((prev) => [...prev, warning]);
  }, []);

  const dismissWarning = useCallback((warningId: string) => {
    setWarnings((prev) => prev.filter((w) => w.id !== warningId));
  }, []);

  const clearWarnings = useCallback(() => {
    setWarnings([]);
  }, []);

  return {
    config,
    warnings,
    setConfig,
    addWarning,
    dismissWarning,
    clearWarnings,
  };
}
