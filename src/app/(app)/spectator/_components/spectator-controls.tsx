/**
 * Spectator Controls Component
 * 
 * Provides game control buttons and speed settings for spectator mode.
 */

'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Play, Pause, RotateCcw, Download, Zap, Gauge, Clock } from 'lucide-react';

export type GameSpeed = 'instant' | 'fast' | 'normal';

export interface SpectatorControlsProps {
  isPlaying: boolean;
  isGameStarted: boolean;
  speed: GameSpeed;
  onStart: () => void;
  onPause: () => void;
  onRestart: () => void;
  onSpeedChange: (speed: GameSpeed) => void;
  onExport: () => void;
}

/**
 * Speed configuration
 */
export const SPEED_CONFIG: Record<GameSpeed, { label: string; delay: number; icon: React.ReactNode; description: string }> = {
  instant: {
    label: 'Instant',
    delay: 100,
    icon: <Zap className="h-4 w-4" />,
    description: 'No delay between actions',
  },
  fast: {
    label: 'Fast',
    delay: 500,
    icon: <Gauge className="h-4 w-4" />,
    description: 'Quick gameplay',
  },
  normal: {
    label: 'Normal',
    delay: 2000,
    icon: <Clock className="h-4 w-4" />,
    description: 'Natural pacing',
  },
};

export function SpectatorControls({
  isPlaying,
  isGameStarted,
  speed,
  onStart,
  onPause,
  onRestart,
  onSpeedChange,
  onExport,
}: SpectatorControlsProps) {
  const currentSpeed = SPEED_CONFIG[speed];

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Play/Pause Button */}
          {!isGameStarted ? (
            <Button onClick={onStart} className="gap-2">
              <Play className="h-4 w-4" />
              Start Game
            </Button>
          ) : !isPlaying ? (
            <Button onClick={onStart} variant="default" className="gap-2">
              <Play className="h-4 w-4" />
              Resume
            </Button>
          ) : (
            <Button onClick={onPause} variant="secondary" className="gap-2">
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          )}

          {/* Restart Button */}
          {isGameStarted && (
            <Button onClick={onRestart} variant="outline" className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Restart
            </Button>
          )}

          {/* Export Button */}
          {isGameStarted && (
            <Button onClick={onExport} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          )}

          {/* Speed Selector */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Speed:</span>
            <Select value={speed} onValueChange={(value: GameSpeed) => onSpeedChange(value)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SPEED_CONFIG).map(([value, config]) => (
                  <SelectItem key={value} value={value}>
                    <div className="flex items-center gap-2">
                      {config.icon}
                      <div>
                        <div className="font-medium">{config.label}</div>
                        <div className="text-xs text-muted-foreground">{config.description}</div>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Current speed indicator */}
        {isPlaying && (
          <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex items-center gap-2">
            {currentSpeed.icon}
            <span>{currentSpeed.label} mode - {currentSpeed.delay}ms delay</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
