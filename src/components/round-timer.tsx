'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Clock, 
  AlertTriangle, 
  Play, 
  Pause, 
  SkipForward, 
  Plus,
  Flag,
  Trophy,
  XCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  RoundTimerState, 
  RoundTimerConfig, 
  RoundTimerStatus,
  useRoundTimer,
  formatTime,
  formatLongTime
} from '@/hooks/use-round-timer';

interface RoundTimerWidgetProps {
  config?: Partial<RoundTimerConfig>;
  isPlayerTurn: boolean;
  totalTurns: number;
  onRoundExpire?: () => void;
  onTurnExpire?: () => void;
  className?: string;
}

export function RoundTimerWidget({
  config,
  isPlayerTurn,
  totalTurns,
  onRoundExpire,
  onTurnExpire,
  className,
}: RoundTimerWidgetProps) {
  const fullConfig: RoundTimerConfig = {
    roundDurationMinutes: config?.roundDurationMinutes ?? 50,
    turnDurationSeconds: config?.turnDurationSeconds ?? 60,
    warningThresholdSeconds: config?.warningThresholdSeconds ?? 30,
    overtimeDurationSeconds: config?.overtimeDurationSeconds ?? 300,
    maxExtensions: config?.maxExtensions ?? 2,
    extensionDurationSeconds: config?.extensionDurationSeconds ?? 120,
  };

  const {
    status,
    startRound,
    pauseRound,
    resumeRound,
    endTurn,
    useExtension,
    requestExtension,
    canUseExtension,
    addTime,
  } = useRoundTimer({
    config: fullConfig,
    isPlayerTurn,
    totalTurns,
    onRoundExpire,
    onTurnExpire,
  });

  const [showStartPrompt, setShowStartPrompt] = useState(true);

  const getStateColor = () => {
    switch (status.roundState) {
      case 'warning':
        return 'text-yellow-500';
      case 'overtime':
        return 'text-orange-500';
      case 'expired':
        return 'text-red-500';
      default:
        return 'text-foreground';
    }
  };

  const getProgressColor = () => {
    switch (status.roundState) {
      case 'warning':
        return 'bg-yellow-500';
      case 'overtime':
        return 'bg-orange-500';
      case 'expired':
        return 'bg-red-500';
      default:
        return 'bg-primary';
    }
  };

  const roundProgress = (status.roundTimeRemaining / (fullConfig.roundDurationMinutes * 60)) * 100;
  const turnProgress = fullConfig.turnDurationSeconds > 0 
    ? (status.turnTimeRemaining / fullConfig.turnDurationSeconds) * 100 
    : 100;

  if (showStartPrompt && status.roundState === 'idle') {
    return (
      <Card className={cn('w-full max-w-md', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Round Timer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center py-4">
            <Trophy className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Start the round timer when you're ready to begin your match.
            </p>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Round Duration:</span>
              <span>{fullConfig.roundDurationMinutes} min</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Turn Duration:</span>
              <span>{fullConfig.turnDurationSeconds} sec</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Time Extensions:</span>
              <span>{fullConfig.maxExtensions} ({fullConfig.extensionDurationSeconds / 60} min each)</span>
            </div>
          </div>

          <Button onClick={() => { startRound(); setShowStartPrompt(false); }} className="w-full">
            <Play className="w-4 h-4 mr-2" />
            Start Round
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('w-full max-w-md', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Clock className={cn('w-4 h-4', getStateColor())} />
            Round Timer
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            Turn {status.currentTurn}/{status.totalTurns}
          </span>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Round Time */}
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Round Time</span>
            <span className={cn('font-mono font-medium', getStateColor())}>
              {formatLongTime(status.roundTimeRemaining)}
            </span>
          </div>
          <Progress value={roundProgress} className="h-2" />
        </div>

        {/* Turn Time (only shown during player's turn) */}
        {isPlayerTurn && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Your Turn</span>
              <span className={cn('font-mono font-medium', getStateColor())}>
                {formatTime(status.turnTimeRemaining)}
              </span>
            </div>
            <Progress value={turnProgress} className="h-2" />
          </div>
        )}

        {/* Extensions Used */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Extensions Used</span>
          <div className="flex items-center gap-1">
            {Array.from({ length: fullConfig.maxExtensions }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'w-2 h-2 rounded-full',
                  i < status.extensionsUsed ? 'bg-orange-500' : 'bg-muted'
                )}
              />
            ))}
          </div>
        </div>

        {/* Warning/Expired States */}
        {status.roundState === 'warning' && (
          <Alert className="py-2 bg-yellow-500/10 border-yellow-500/50">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <AlertDescription className="text-yellow-500">Less than {fullConfig.warningThresholdSeconds} seconds remaining!</AlertDescription>
          </Alert>
        )}

        {status.roundState === 'expired' && (
          <Alert variant="destructive" className="py-2">
            <XCircle className="h-4 w-4" />
            <AlertDescription>Time's up! Round has ended.</AlertDescription>
          </Alert>
        )}

        {/* Controls */}
        <div className="flex flex-wrap gap-2">
          {status.roundState === 'running' ? (
            <Button variant="outline" size="sm" onClick={pauseRound}>
              <Pause className="w-4 h-4" />
            </Button>
          ) : status.roundState === 'paused' ? (
            <Button variant="outline" size="sm" onClick={resumeRound}>
              <Play className="w-4 h-4" />
            </Button>
          ) : null}

          {isPlayerTurn && status.roundState === 'running' && (
            <>
              <Button variant="outline" size="sm" onClick={endTurn}>
                <SkipForward className="w-4 h-4 mr-1" />
                End Turn
              </Button>
              
              {canUseExtension && (
                <Button variant="outline" size="sm" onClick={requestExtension}>
                  <Flag className="w-4 h-4 mr-1" />
                  Request Time
                </Button>
              )}
            </>
          )}

          {canUseExtension && (
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={useExtension}
              className="ml-auto"
            >
              <Plus className="w-4 h-4 mr-1" />
              +{fullConfig.extensionDurationSeconds / 60} min
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Compact version for tournament mode
interface CompactRoundTimerProps {
  status: RoundTimerStatus;
  config: RoundTimerConfig;
  className?: string;
}

export function CompactRoundTimer({ 
  status, 
  config,
  className 
}: CompactRoundTimerProps) {
  const getStateColor = () => {
    switch (status.roundState) {
      case 'warning':
        return 'text-yellow-500';
      case 'overtime':
        return 'text-orange-500';
      case 'expired':
        return 'text-red-500';
      default:
        return 'text-foreground';
    }
  };

  return (
    <div className={cn('flex items-center gap-3 text-sm', className)}>
      <Clock className={cn('w-4 h-4', getStateColor())} />
      <span className={cn('font-mono min-w-[60px]', getStateColor())}>
        {formatLongTime(status.roundTimeRemaining)}
      </span>
      {status.isPlayerTurn && (
        <>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">Turn:</span>
          <span className={cn('font-mono', getStateColor())}>
            {formatTime(status.turnTimeRemaining)}
          </span>
        </>
      )}
    </div>
  );
}
