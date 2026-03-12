/**
 * Commentary Panel Component
 * 
 * Displays play-by-play commentary for spectator mode.
 * Shows the most recent commentary at the top with highlighting.
 */

'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, Clock } from 'lucide-react';
import type { CommentaryEntry } from '@/ai/spectator-commentary';

interface CommentaryPanelProps {
  commentary: CommentaryEntry[];
  maxDisplay?: number;
}

export function CommentaryPanel({ commentary, maxDisplay = 50 }: CommentaryPanelProps) {
  // Limit displayed commentary
  const displayCommentary = commentary.slice(0, maxDisplay);

  // Group commentary by type for styling
  const getCommentaryStyle = (type: CommentaryEntry['type'], index: number) => {
    const baseClasses = 'text-sm p-2 rounded-md transition-colors';
    const isFirst = index === 0;
    
    // Type-specific colors
    const typeColors: Record<CommentaryEntry['type'], string> = {
      turn_start: isFirst ? 'bg-blue-500/20 text-blue-300 border-l-4 border-blue-500' : 'bg-blue-500/10 text-blue-400',
      land_play: isFirst ? 'bg-green-500/20 text-green-300 border-l-4 border-green-500' : 'bg-green-500/10 text-green-400',
      spell_cast: isFirst ? 'bg-purple-500/20 text-purple-300 border-l-4 border-purple-500' : 'bg-purple-500/10 text-purple-400',
      creature_attack: isFirst ? 'bg-red-500/20 text-red-300 border-l-4 border-red-500' : 'bg-red-500/10 text-red-400',
      creature_block: isFirst ? 'bg-orange-500/20 text-orange-300 border-l-4 border-orange-500' : 'bg-orange-500/10 text-orange-400',
      damage_dealt: isFirst ? 'bg-red-500/20 text-red-300 border-l-4 border-red-500' : 'bg-red-500/10 text-red-400',
      life_change: isFirst ? 'bg-yellow-500/20 text-yellow-300 border-l-4 border-yellow-500' : 'bg-yellow-500/10 text-yellow-400',
      creature_dies: isFirst ? 'bg-gray-500/20 text-gray-300 border-l-4 border-gray-500' : 'bg-gray-500/10 text-gray-400',
      player_wins: 'bg-gradient-to-r from-yellow-500/30 to-amber-500/30 text-yellow-200 border-l-4 border-yellow-500 font-bold',
      game_message: isFirst ? 'bg-blue-500/20 text-blue-300 border-l-4 border-blue-500' : 'bg-blue-500/10 text-blue-400',
      mana_ability: isFirst ? 'bg-cyan-500/20 text-cyan-300 border-l-4 border-cyan-500' : 'bg-cyan-500/10 text-cyan-400',
      phase_change: isFirst ? 'bg-indigo-500/20 text-indigo-300 border-l-4 border-indigo-500' : 'bg-indigo-500/10 text-indigo-400',
    };

    return `${baseClasses} ${typeColors[type] || ''} ${isFirst ? 'font-semibold' : ''}`;
  };

  // Format timestamp for display
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Commentary
          {commentary.length > 0 && (
            <span className="text-sm text-muted-foreground font-normal">
              ({commentary.length} entries)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {displayCommentary.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Game commentary will appear here</p>
            <p className="text-xs mt-1">Start the game to see play-by-play narration</p>
          </div>
        ) : (
          <ScrollArea className="h-[280px] pr-4">
            <div className="space-y-2">
              {displayCommentary.map((entry, index) => (
                <div
                  key={entry.id}
                  className={getCommentaryStyle(entry.type, index)}
                >
                  <div className="flex items-start gap-2">
                    {index === 0 && (
                      <span className="text-xs mt-0.5">→</span>
                    )}
                    {index > 0 && (
                      <span className="text-xs mt-0.5 opacity-50">•</span>
                    )}
                    <div className="flex-1">
                      <p>{entry.text}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTime(entry.timestamp)}
                        </span>
                        <span>Turn {entry.turnNumber}</span>
                        {entry.phase && (
                          <span className="capitalize">{entry.phase}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
