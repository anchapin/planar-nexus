'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Smile, ThumbsUp, Heart, Zap, Skull, Clock, HelpCircle, Laugh, Angry, PartyPopper } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EmoteType = 
  | 'thumbsup' 
  | 'heart' 
  | 'zap' 
  | 'skull' 
  | 'clock' 
  | 'thinking' 
  | 'laugh' 
  | 'angry' 
  | 'party'
  | 'hello';

export interface Emote {
  type: EmoteType;
  label: string;
  icon: React.ReactNode;
}

export const EMOTES: Emote[] = [
  { type: 'hello', label: 'Hello', icon: <Smile className="w-5 h-5" /> },
  { type: 'thumbsup', label: 'Thumbs Up', icon: <ThumbsUp className="w-5 h-5" /> },
  { type: 'heart', label: 'Love', icon: <Heart className="w-5 h-5" /> },
  { type: 'zap', label: 'Power', icon: <Zap className="w-5 h-5" /> },
  { type: 'skull', label: 'GG', icon: <Skull className="w-5 h-5" /> },
  { type: 'clock', label: 'Hurry', icon: <Clock className="w-5 h-5" /> },
  { type: 'thinking', label: 'Think', icon: <HelpCircle className="w-5 h-5" /> },
  { type: 'laugh', label: 'Funny', icon: <Laugh className="w-5 h-5" /> },
  { type: 'angry', label: 'Angry', icon: <Angry className="w-5 h-5" /> },
  { type: 'party', label: 'Nice!', icon: <PartyPopper className="w-5 h-5" /> },
];

export interface EmoteMessage {
  id: string;
  playerId: string;
  playerName: string;
  emote: EmoteType;
  timestamp: number;
}

interface EmotePickerProps {
  onSelectEmote: (emote: EmoteType) => void;
  disabled?: boolean;
  className?: string;
}

export function EmotePicker({ onSelectEmote, disabled, className }: EmotePickerProps) {
  const [open, setOpen] = useState(false);

  const handleEmoteSelect = (emote: EmoteType) => {
    onSelectEmote(emote);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          disabled={disabled}
          className={cn('h-8 w-8', className)}
          aria-label="Open emote picker"
          aria-expanded={open}
        >
          <Smile className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start" role="listbox" aria-label="Select an emote">
        <div className="grid grid-cols-5 gap-1" role="listbox">
          {EMOTES.map((emote) => (
            <Button
              key={emote.type}
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-muted"
              onClick={() => handleEmoteSelect(emote.type)}
              aria-label={emote.label}
              title={emote.label}
            >
              {emote.icon}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Display a single emote (used in chat or game board)
interface EmoteDisplayProps {
  emote: EmoteType;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function EmoteDisplay({ emote, size = 'md', className }: EmoteDisplayProps) {
  const emoteData = EMOTES.find((e) => e.type === emote);
  
  if (!emoteData) return null;

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  return (
    <span className={cn('inline-flex', sizeClasses[size], className)} title={emoteData.label}>
      {emoteData.icon}
    </span>
  );
}

// Emote message list for displaying recent emotes
interface EmoteFeedProps {
  emotes: EmoteMessage[];
  className?: string;
}

export function EmoteFeed({ emotes, className }: EmoteFeedProps) {
  // Show only the last 5 emotes
  const recentEmotes = emotes.slice(-5);

  if (recentEmotes.length === 0) return null;

  return (
    <div className={cn('flex gap-1 flex-wrap', className)} role="log" aria-live="polite" aria-label="Recent emotes">
      {recentEmotes.map((emote) => (
        <div
          key={emote.id}
          className="flex items-center gap-1 bg-muted/80 px-2 py-1 rounded-full text-xs"
          title={`${emote.playerName}: ${EMOTES.find(e => e.type === emote.emote)?.label}`}
        >
          <EmoteDisplay emote={emote.emote} size="sm" />
          <span className="text-muted-foreground">{emote.playerName}</span>
        </div>
      ))}
    </div>
  );
}
