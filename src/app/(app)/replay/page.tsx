'use client';

import { useEffect, useState } from 'react';
import { getReplayFromCurrentURL } from '@/lib/replay-sharing';
import { type Replay } from '@/lib/game-state/replay';
import Link from 'next/link';

// Type for player state in replay
interface ReplayPlayerState {
  id: string;
  name: string;
  life: number;
  hand?: unknown[];
}

/**
 * Replay Viewer Page
 * 
 * Issue #92: Phase 5.3: Implement replay system with shareable links
 * 
 * Displays a shared replay that was opened via URL parameter
 */
export default function ReplayPage() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    // Try to get replay from URL
    const urlReplay = getReplayFromCurrentURL();
    
    if (urlReplay) {
      setReplay(urlReplay);
      setCurrentPosition(urlReplay.currentPosition);
      setLoading(false);
      return;
    }

    // If no replay in URL, check if there's a replay ID in the path
    const pathParts = window.location.pathname.split('/');
    const replayId = pathParts[pathParts.length - 1];
    
    if (replayId && replayId !== 'replay') {
      // Would fetch from server in production
      setError('Replay not found. The link may have expired.');
    } else {
      setError('No replay data found. Please check your link.');
    }
    
    setLoading(false);
  }, []);

  const handlePrevious = () => {
    if (currentPosition > 0) {
      setCurrentPosition(currentPosition - 1);
    }
  };

  const handleNext = () => {
    if (replay && currentPosition < replay.totalActions - 1) {
      setCurrentPosition(currentPosition + 1);
    }
  };

  const handleJumpToStart = () => {
    setCurrentPosition(0);
  };

  const handleJumpToEnd = () => {
    if (replay) {
      setCurrentPosition(replay.totalActions - 1);
    }
  };

  const togglePlayback = () => {
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    if (!isPlaying || !replay) return;

    const interval = setInterval(() => {
      setCurrentPosition(pos => {
        if (pos >= replay.totalActions - 1) {
          setIsPlaying(false);
          return pos;
        }
        return pos + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, replay]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading replay...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
        <div className="text-red-400 text-xl">{error}</div>
        <Link 
          href="/saved-games" 
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Go to Saved Games
        </Link>
      </div>
    );
  }

  if (!replay) {
    return null;
  }

  const currentAction = replay.actions[currentPosition];
  const progress = replay.totalActions > 0 
    ? ((currentPosition + 1) / replay.totalActions) * 100 
    : 0;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Game Replay</h1>
          <div className="text-slate-400">
            <p>Format: {replay.metadata.format}</p>
            <p>Players: {replay.metadata.playerNames.join(' vs ')}</p>
            <p>Started: {new Date(replay.metadata.gameStartDate).toLocaleString()}</p>
            {replay.metadata.winners && (
              <p className="text-yellow-400">
                Winner: {replay.metadata.winners.join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* Replay Viewer */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <span className="text-slate-400">
              Action {currentPosition + 1} of {replay.totalActions}
            </span>
            <span className="text-slate-400">
              Turn {currentAction?.resultingState?.turn?.turnNumber || 1}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-700 rounded-full h-2 mb-6">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Current action description */}
          <div className="text-lg mb-4 min-h-[60px]">
            {currentAction ? (
              <p>{currentAction.description}</p>
            ) : (
              <p className="text-slate-500">No actions recorded</p>
            )}
          </div>

          {/* Game state summary */}
          {currentAction?.resultingState && (
            <div className="grid grid-cols-2 gap-4 text-sm mb-4">
              {Array.from(currentAction.resultingState.players?.values() || []).map((player: ReplayPlayerState) => (
                <div key={player.id} className="bg-slate-700 p-3 rounded">
                  <div className="font-bold">{player.name}</div>
                  <div className="text-slate-400">
                    Life: {player.life} | 
                    Hand: {player.hand?.length || 0}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Playback controls */}
          <div className="flex justify-center gap-4">
            <button
              onClick={handleJumpToStart}
              disabled={currentPosition === 0}
              className="px-4 py-2 bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-600"
            >
              ⏮ Jump to Start
            </button>
            <button
              onClick={handlePrevious}
              disabled={currentPosition === 0}
              className="px-4 py-2 bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-600"
            >
              ◀ Previous
            </button>
            <button
              onClick={togglePlayback}
              className="px-6 py-2 bg-blue-600 rounded hover:bg-blue-700"
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <button
              onClick={handleNext}
              disabled={currentPosition >= replay.totalActions - 1}
              className="px-4 py-2 bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-600"
            >
              Next ▶
            </button>
            <button
              onClick={handleJumpToEnd}
              disabled={currentPosition >= replay.totalActions - 1}
              className="px-4 py-2 bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-600"
            >
              Jump to End ⏭
            </button>
          </div>
        </div>

        {/* Action history */}
        <div className="bg-slate-800 rounded-lg p-4">
          <h2 className="text-lg font-bold mb-3">Action History</h2>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {replay.actions.map((action, index) => (
              <button
                key={action.sequenceNumber}
                onClick={() => setCurrentPosition(index)}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  index === currentPosition
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 hover:bg-slate-600'
                }`}
              >
                <span className="text-slate-400 mr-2">{index + 1}.</span>
                {action.description}
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <Link 
            href="/saved-games" 
            className="text-blue-400 hover:underline"
          >
            View Saved Games
          </Link>
        </div>
      </div>
    </div>
  );
}
