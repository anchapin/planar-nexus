'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { 
  generateShareableURL, 
  decodeReplayFromURL, 
  copyShareableLink, 
  exportReplayToFile,
  importReplayFromFile,
  canShareViaURL,
  getEstimatedURLLength
} from '@/lib/replay-sharing';
import type { Replay, ReplayAction, ReplayMetadata } from '@/lib/game-state/replay';

/**
 * Replay Viewer Component
 * 
 * Issue #291: Feature: Add replay system with shareable links
 * 
 * Provides:
 * - Game replay recording
 * - Replay playback controls (play, pause, step, speed)
 * - Shareable replay links
 * - Replay storage and management
 */

// Playback speed options
const PLAYBACK_SPEEDS = [0.5, 1, 1.5, 2, 4] as const;

// Replay viewer props
export interface ReplayViewerProps {
  replay: Replay | null;
  onPositionChange?: (position: number) => void;
  onStateChange?: (state: any) => void;
  className?: string;
}

// Replay player state
interface PlayerState {
  isPlaying: boolean;
  position: number;
  speed: number;
  volume: number;
}

// Main replay viewer component
export function ReplayViewer({ 
  replay, 
  onPositionChange, 
  onStateChange,
  className 
}: ReplayViewerProps) {
  const [playerState, setPlayerState] = useState<PlayerState>({
    isPlaying: false,
    position: 0,
    speed: 1,
    volume: 1,
  });
  
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showActionList, setShowActionList] = useState(false);
  
  const playbackRef = useRef<NodeJS.Timeout | null>(null);
  const totalActions = replay?.totalActions || 0;

  // Playback loop
  useEffect(() => {
    if (playerState.isPlaying && replay) {
      playbackRef.current = setInterval(() => {
        setPlayerState(prev => {
          const newPosition = prev.position + 1;
          if (newPosition >= totalActions) {
            return { ...prev, isPlaying: false, position: totalActions - 1 };
          }
          onPositionChange?.(newPosition);
          const action = replay.actions[newPosition];
          if (action) {
            onStateChange?.(action.resultingState);
          }
          return { ...prev, position: newPosition };
        });
      }, 1000 / playerState.speed);
    }

    return () => {
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
      }
    };
  }, [playerState.isPlaying, playerState.speed, replay, totalActions, onPositionChange, onStateChange]);

  // Play/pause toggle
  const togglePlay = useCallback(() => {
    if (!replay) return;
    
    if (playerState.position >= totalActions - 1 && !playerState.isPlaying) {
      // Restart from beginning if at end
      setPlayerState(prev => ({ ...prev, position: 0, isPlaying: true }));
      onPositionChange?.(0);
      const action = replay.actions[0];
      if (action) {
        onStateChange?.(action.resultingState);
      }
    } else {
      setPlayerState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
    }
  }, [replay, playerState.position, playerState.isPlaying, totalActions, onPositionChange, onStateChange]);

  // Step forward
  const stepForward = useCallback(() => {
    if (!replay || playerState.position >= totalActions - 1) return;
    
    const newPosition = playerState.position + 1;
    setPlayerState(prev => ({ ...prev, position: newPosition, isPlaying: false }));
    onPositionChange?.(newPosition);
    const action = replay.actions[newPosition];
    if (action) {
      onStateChange?.(action.resultingState);
    }
  }, [replay, playerState.position, totalActions, onPositionChange, onStateChange]);

  // Step backward
  const stepBackward = useCallback(() => {
    if (!replay || playerState.position <= 0) return;
    
    const newPosition = playerState.position - 1;
    setPlayerState(prev => ({ ...prev, position: newPosition, isPlaying: false }));
    onPositionChange?.(newPosition);
    const action = replay.actions[newPosition];
    if (action) {
      onStateChange?.(action.resultingState);
    }
  }, [replay, playerState.position, onPositionChange, onStateChange]);

  // Jump to position
  const jumpToPosition = useCallback((position: number) => {
    if (!replay) return;
    
    const validPosition = Math.max(0, Math.min(position, totalActions - 1));
    setPlayerState(prev => ({ ...prev, position: validPosition, isPlaying: false }));
    onPositionChange?.(validPosition);
    const action = replay.actions[validPosition];
    if (action) {
      onStateChange?.(action.resultingState);
    }
  }, [replay, totalActions, onPositionChange, onStateChange]);

  // Change speed
  const changeSpeed = useCallback((speed: number) => {
    setPlayerState(prev => ({ ...prev, speed }));
  }, []);

  // Generate shareable link
  const handleShare = useCallback(async () => {
    if (!replay) return;
    
    const url = generateShareableURL(replay);
    if (url) {
      setShareUrl(url);
    } else {
      // Replay too large for URL, need to export
      setShareUrl(null);
    }
    setShowShareDialog(true);
  }, [replay]);

  // Copy link to clipboard
  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    
    const success = await copyShareableLink(replay!);
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  }, [shareUrl, replay]);

  // Export replay to file
  const handleExport = useCallback(() => {
    if (!replay) return;
    exportReplayToFile(replay);
  }, [replay]);

  // Current action info
  const currentAction = useMemo(() => {
    if (!replay || playerState.position < 0) return null;
    return replay.actions[playerState.position];
  }, [replay, playerState.position]);

  // Format time
  const formatDuration = useCallback((ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }, []);

  if (!replay) {
    return (
      <div className={cn('p-4 bg-card border rounded-lg text-center', className)}>
        <p className="text-muted-foreground">No replay loaded</p>
        <p className="text-sm text-muted-foreground mt-1">
          Start a game to record a replay
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4 p-4 bg-card border rounded-lg', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Game Replay</h3>
          <p className="text-sm text-muted-foreground">
            {replay.metadata.format} • {replay.metadata.playerNames.join(' vs ')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleShare}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 text-sm"
          >
            Share
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90 text-sm"
          >
            Export
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-12">
            {playerState.position + 1}
          </span>
          <input
            type="range"
            min={0}
            max={totalActions - 1}
            value={playerState.position}
            onChange={(e) => jumpToPosition(parseInt(e.target.value))}
            className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-xs text-muted-foreground w-12 text-right">
            {totalActions}
          </span>
        </div>
        
        {/* Action description */}
        {currentAction && (
          <div className="text-sm text-center text-muted-foreground">
            {currentAction.description}
          </div>
        )}
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-center gap-4">
        {/* Skip to start */}
        <button
          onClick={() => jumpToPosition(0)}
          disabled={playerState.position === 0}
          className="p-2 hover:bg-muted rounded disabled:opacity-50"
          title="Skip to start"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>

        {/* Step backward */}
        <button
          onClick={stepBackward}
          disabled={playerState.position === 0}
          className="p-2 hover:bg-muted rounded disabled:opacity-50"
          title="Step backward"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="p-3 bg-primary text-primary-foreground rounded-full hover:bg-primary/90"
          title={playerState.isPlaying ? 'Pause' : 'Play'}
        >
          {playerState.isPlaying ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </button>

        {/* Step forward */}
        <button
          onClick={stepForward}
          disabled={playerState.position >= totalActions - 1}
          className="p-2 hover:bg-muted rounded disabled:opacity-50"
          title="Step forward"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
          </svg>
        </button>

        {/* Skip to end */}
        <button
          onClick={() => jumpToPosition(totalActions - 1)}
          disabled={playerState.position >= totalActions - 1}
          className="p-2 hover:bg-muted rounded disabled:opacity-50"
          title="Skip to end"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Speed control */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-xs text-muted-foreground">Speed:</span>
        <div className="flex gap-1">
          {PLAYBACK_SPEEDS.map((speed) => (
            <button
              key={speed}
              onClick={() => changeSpeed(speed)}
              className={cn(
                'px-2 py-1 text-xs rounded',
                playerState.speed === speed
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              )}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      {/* Game info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
        <div>
          Turn {currentAction?.resultingState?.turn?.turnNumber || 1}
        </div>
        <div>
          {replay.metadata.winners ? (
            <span className="text-green-500">
              Winner: {replay.metadata.winners.join(', ')}
            </span>
          ) : (
            'In progress'
          )}
        </div>
        <div>
          {formatDuration(
            replay.metadata.gameEndDate 
              ? replay.metadata.gameEndDate - replay.metadata.gameStartDate
              : Date.now() - replay.metadata.gameStartDate
          )}
        </div>
      </div>

      {/* Action list toggle */}
      <button
        onClick={() => setShowActionList(!showActionList)}
        className="text-sm text-primary hover:underline"
      >
        {showActionList ? 'Hide' : 'Show'} action history
      </button>

      {/* Action list */}
      {showActionList && (
        <div className="max-h-60 overflow-y-auto border rounded p-2">
          {replay.actions.map((action, index) => (
            <button
              key={action.sequenceNumber}
              onClick={() => jumpToPosition(index)}
              className={cn(
                'w-full text-left px-2 py-1 rounded text-sm',
                index === playerState.position
                  ? 'bg-primary/20 text-primary'
                  : 'hover:bg-muted'
              )}
            >
              <span className="text-muted-foreground mr-2">
                #{action.sequenceNumber}
              </span>
              {action.description}
            </button>
          ))}
        </div>
      )}

      {/* Share dialog */}
      {showShareDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold text-lg mb-4">Share Replay</h3>
            
            {shareUrl ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Share this link to let others view the replay:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 px-3 py-2 bg-muted rounded text-sm truncate"
                  />
                  <button
                    onClick={handleCopyLink}
                    className={cn(
                      'px-4 py-2 rounded text-sm',
                      copySuccess 
                        ? 'bg-green-500 text-white'
                        : 'bg-primary text-primary-foreground'
                    )}
                  >
                    {copySuccess ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  URL length: {getEstimatedURLLength(replay)} characters
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This replay is too large to share via URL. Export it as a file instead:
                </p>
                <button
                  onClick={handleExport}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground rounded"
                >
                  Export as JSON file
                </button>
              </div>
            )}
            
            <button
              onClick={() => setShowShareDialog(false)}
              className="mt-4 w-full px-4 py-2 bg-muted rounded hover:bg-muted/80"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Replay list component for managing multiple replays
export interface ReplayListProps {
  replays: Replay[];
  onSelect: (replay: Replay) => void;
  onDelete?: (replayId: string) => void;
  className?: string;
}

export function ReplayList({ replays, onSelect, onDelete, className }: ReplayListProps) {
  const [importing, setImporting] = useState(false);

  const handleImport = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const replay = await importReplayFromFile(file);
      onSelect(replay);
    } catch (error) {
      console.error('Failed to import replay:', error);
    } finally {
      setImporting(false);
    }
  }, [onSelect]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Import button */}
      <div className="flex justify-end">
        <label className="px-4 py-2 bg-primary text-primary-foreground rounded cursor-pointer hover:bg-primary/90">
          {importing ? 'Importing...' : 'Import Replay'}
          <input
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
            }}
            disabled={importing}
          />
        </label>
      </div>

      {/* Replay list */}
      {replays.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No replays saved yet
        </div>
      ) : (
        <div className="space-y-2">
          {replays.map((replay) => (
            <div
              key={replay.id}
              className="flex items-center justify-between p-4 bg-card border rounded-lg hover:border-primary/50 cursor-pointer"
              onClick={() => onSelect(replay)}
            >
              <div>
                <h4 className="font-medium">
                  {replay.metadata.format} - {replay.metadata.playerNames.join(' vs ')}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {formatDate(replay.createdAt)} • {replay.totalActions} actions
                </p>
                {replay.metadata.winners && (
                  <p className="text-sm text-green-500">
                    Winner: {replay.metadata.winners.join(', ')}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {onDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(replay.id);
                    }}
                    className="p-2 text-destructive hover:bg-destructive/10 rounded"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Hook for managing replay storage
export function useReplayStorage() {
  const [replays, setReplays] = useState<Replay[]>([]);
  const STORAGE_KEY = 'planar-nexus-replays';

  // Load replays from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setReplays(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load replays:', error);
    }
  }, []);

  // Save replay
  const saveReplay = useCallback((replay: Replay) => {
    setReplays(prev => {
      const updated = [...prev, replay];
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  // Delete replay
  const deleteReplay = useCallback((replayId: string) => {
    setReplays(prev => {
      const updated = prev.filter(r => r.id !== replayId);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  // Clear all replays
  const clearReplays = useCallback(() => {
    setReplays([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return {
    replays,
    saveReplay,
    deleteReplay,
    clearReplays,
  };
}

// Hook for loading replay from URL
export function useReplayFromURL() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const encoded = urlParams.get('replay');

    if (encoded) {
      try {
        const decoded = decodeReplayFromURL(encoded);
        if (decoded) {
          setReplay(decoded);
        } else {
          setError('Failed to decode replay from URL');
        }
      } catch (err) {
        setError('Invalid replay data in URL');
      }
    }

    setLoading(false);
  }, []);

  return { replay, loading, error };
}

export default ReplayViewer;