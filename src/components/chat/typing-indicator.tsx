'use client';

import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TypingIndicatorProps {
  className?: string;
}

export function TypingIndicator({ className }: TypingIndicatorProps) {
  return (
    <div 
      className={cn('flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300', className)}
      role="status"
      aria-label="AI is thinking"
    >
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-primary" />
      </div>
      <div className="bg-muted rounded-2xl rounded-tl-none px-4 py-3 flex gap-1 items-center h-9">
        <span 
          className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" 
          style={{ animationDelay: '-0.3s' }}
          aria-hidden="true"
        />
        <span 
          className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" 
          style={{ animationDelay: '-0.15s' }}
          aria-hidden="true"
        />
        <span 
          className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" 
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
