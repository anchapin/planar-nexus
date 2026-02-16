'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Eye, EyeOff, Users, MessageCircle, Settings, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Spectator, SpectatorPermissions } from '@/lib/spectator';

interface SpectatorViewProps {
  spectators: Spectator[];
  currentSpectatorId?: string;
  permissions: SpectatorPermissions;
  onToggleVisibility?: () => void;
  onOpenChat?: () => void;
  onOpenSettings?: () => void;
  className?: string;
}

export function SpectatorView({
  spectators,
  currentSpectatorId,
  permissions,
  onToggleVisibility,
  onOpenChat,
  onOpenSettings,
  className,
}: SpectatorViewProps) {
  const [visibleSpectators, setVisibleSpectators] = useState<Spectator[]>(spectators);

  useEffect(() => {
    // Filter hidden spectators based on permissions
    if (permissions.isHidden) {
      setVisibleSpectators(
        spectators.filter((s) => !s.isHidden || s.id === currentSpectatorId)
      );
    } else {
      setVisibleSpectators(spectators);
    }
  }, [spectators, permissions.isHidden, currentSpectatorId]);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="w-4 h-4" />
            Spectators
            <Badge variant="secondary" className="ml-1">
              {spectators.length}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            {permissions.canChat && (
              <Button variant="ghost" size="icon" onClick={onOpenChat}>
                <MessageCircle className="w-4 h-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onToggleVisibility}>
              {permissions.isHidden ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onOpenSettings}>
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {visibleSpectators.length === 0 ? (
          <div className="text-center text-muted-foreground py-4">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No spectators yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleSpectators.map((spectator) => (
              <div
                key={spectator.id}
                className={cn(
                  'flex items-center justify-between p-2 rounded-md',
                  spectator.id === currentSpectatorId && 'bg-primary/10'
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <span className="text-sm font-medium">
                      {spectator.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{spectator.name}</p>
                    {spectator.id === currentSpectatorId && (
                      <p className="text-xs text-muted-foreground">You</p>
                    )}
                  </div>
                </div>
                {spectator.isHidden && (
                  <Badge variant="outline" className="text-xs">
                    <EyeOff className="w-3 h-3 mr-1" />
                    Hidden
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Spectator banner component (shown at top of game when spectating)
interface SpectatorBannerProps {
  playerCount: number;
  spectatorCount: number;
  onLeave?: () => void;
  className?: string;
}

export function SpectatorBanner({
  playerCount,
  spectatorCount,
  onLeave,
  className,
}: SpectatorBannerProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-2 bg-muted/50 border-b',
        className
      )}
    >
      <div className="flex items-center gap-4">
        <Badge variant="outline" className="bg-background">
          <Crown className="w-3 h-3 mr-1" />
          Spectating
        </Badge>
        <span className="text-sm text-muted-foreground">
          {playerCount} player{playerCount !== 1 ? 's' : ''} in game
        </span>
        {spectatorCount > 0 && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm text-muted-foreground">
              <Eye className="w-3 h-3 inline mr-1" />
              {spectatorCount} spectator{spectatorCount !== 1 ? 's' : ''} watching
            </span>
          </>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={onLeave}>
        Leave Game
      </Button>
    </div>
  );
}

// Join as spectator button/modal
interface JoinSpectatorProps {
  gameId: string;
  onJoin: (name: string, isHidden: boolean) => void;
  className?: string;
}

export function JoinSpectatorForm({ onJoin, className }: { onJoin: (name: string, isHidden: boolean) => void; className?: string }) {
  const [name, setName] = useState('');
  const [isHidden, setIsHidden] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onJoin(name.trim(), isHidden);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-4', className)}>
      <div className="space-y-2">
        <label htmlFor="spectator-name" className="text-sm font-medium">
          Spectator Name
        </label>
        <input
          id="spectator-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name"
          className="w-full px-3 py-2 border rounded-md"
          maxLength={20}
          required
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="spectator-hidden"
          type="checkbox"
          checked={isHidden}
          onChange={(e) => setIsHidden(e.target.checked)}
          className="rounded"
        />
        <label htmlFor="spectator-hidden" className="text-sm text-muted-foreground">
          Join as hidden spectator
        </label>
      </div>
      <Button type="submit" className="w-full" disabled={!name.trim()}>
        <Eye className="w-4 h-4 mr-2" />
        Join as Spectator
      </Button>
    </form>
  );
}
