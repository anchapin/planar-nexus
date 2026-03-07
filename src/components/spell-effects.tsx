'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

// Spell effect types
export type SpellEffectType = 
  | 'cast' 
  | 'resolve' 
  | 'counter' 
  | 'transform' 
  | 'token'
  | 'draw'
  | 'discard'
  | 'mill';

export type SpellColor = 'blue' | 'red' | 'green' | 'black' | 'white' | 'colorless';

export interface SpellEvent {
  id: string;
  type: SpellEffectType;
  color?: SpellColor;
  cardName?: string;
  timestamp: number;
}

interface SpellEffectProps {
  event: SpellEvent;
  onComplete?: (id: string) => void;
  className?: string;
}

interface SpellEffectsProps {
  events: SpellEvent[];
  onEventComplete?: (id: string) => void;
  className?: string;
}

// Spell cast animation component
export function SpellEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'start' | 'active' | 'end'>('start');
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(0.5);
  const [rotation, setRotation] = useState(0);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    // Start phase - scale up and fade in
    const startTimer = setTimeout(() => {
      setPhase('active');
      setScale(1.2);
      setOpacity(1);
    }, 50);

    // Active phase - spin and pulse
    const activeTimer = setTimeout(() => {
      setPhase('active');
      setScale(1);
      setRotation(360);
    }, 300);

    // End phase - fade out
    const endTimer = setTimeout(() => {
      setPhase('end');
      setScale(1.5);
      setOpacity(0);
      onComplete?.(event.id);
    }, 1200);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(activeTimer);
      clearTimeout(endTimer);
    };
  }, [event.id, onComplete]);

  const getEffectColor = () => {
    switch (event.color) {
      case 'blue':
        return 'bg-blue-500 shadow-blue-500/50';
      case 'red':
        return 'bg-red-500 shadow-red-500/50';
      case 'green':
        return 'bg-green-500 shadow-green-500/50';
      case 'black':
        return 'bg-gray-800 shadow-gray-800/50';
      case 'white':
        return 'bg-yellow-100 shadow-yellow-100/50';
      default:
        return 'bg-purple-500 shadow-purple-500/50';
    }
  };

  const getEffectIcon = () => {
    switch (event.type) {
      case 'cast':
        return '✨';
      case 'resolve':
        return '✅';
      case 'counter':
        return '🚫';
      case 'transform':
        return '🔄';
      case 'token':
        return '🪙';
      case 'draw':
        return '📤';
      case 'discard':
        return '🗑️';
      case 'mill':
        return '📚';
      default:
        return '✨';
    }
  };

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none',
        'flex items-center justify-center',
        className
      )}
      style={{
        transform: `translate(-50%, -50%) scale(${scale}) rotate(${rotation}deg)`,
        opacity,
        transition: 'all 0.5s ease-out',
      }}
    >
      <div
        className={cn(
          'w-24 h-24 rounded-full flex items-center justify-center text-4xl',
          'shadow-lg animate-pulse',
          getEffectColor()
        )}
      >
        {getEffectIcon()}
      </div>
    </div>
  );
}

// Overlay container for multiple spell effects
export function SpellEffects({ events, onEventComplete, className }: SpellEffectsProps) {
  const handleComplete = useCallback((id: string) => {
    onEventComplete?.(id);
  }, [onEventComplete]);

  return (
    <div className={cn('absolute inset-0 pointer-events-none overflow-hidden', className)}>
      {events.map((event) => (
        <SpellEffect
          key={event.id}
          event={event}
          onComplete={handleComplete}
        />
      ))}
    </div>
  );
}

// Hook for managing spell events
interface UseSpellEventsOptions {
  maxEvents?: number;
}

interface UseSpellEventsReturn {
  events: SpellEvent[];
  triggerSpell: (type: SpellEffectType, color?: SpellColor, cardName?: string) => void;
  clearEvents: () => void;
}

export function useSpellEvents({ maxEvents = 5 }: UseSpellEventsOptions = {}): UseSpellEventsReturn {
  const [events, setEvents] = useState<SpellEvent[]>([]);

  const triggerSpell = useCallback((type: SpellEffectType, color?: SpellColor, cardName?: string) => {
    const newEvent: SpellEvent = {
      id: `spell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      color,
      cardName,
      timestamp: Date.now(),
    };

    setEvents((prev) => {
      const updated = [...prev, newEvent];
      if (updated.length > maxEvents) {
        return updated.slice(-maxEvents);
      }
      return updated;
    });
  }, [maxEvents]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const handleEventComplete = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    events,
    triggerSpell,
    clearEvents,
  };
}

// Card transform animation component
interface CardTransformProps {
  fromCard: string;
  toCard: string;
  onComplete?: () => void;
  className?: string;
}

export function CardTransform({ fromCard, toCard, onComplete, className }: CardTransformProps) {
  const [phase, setPhase] = useState<'start' | 'flipping' | 'end'>('start');

  useEffect(() => {
    const flipTimer = setTimeout(() => setPhase('flipping'), 100);
    const completeTimer = setTimeout(() => {
      setPhase('end');
      onComplete?.();
    }, 800);

    return () => {
      clearTimeout(flipTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div
      className={cn(
        'relative w-20 h-28 transition-all duration-500',
        phase === 'flipping' && 'scale-75 rotate-y-180',
        className
      )}
    >
      {/* Front of card (transforming from) */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 rounded',
          'flex items-center justify-center text-2xl',
          phase === 'flipping' && 'opacity-0'
        )}
      >
        {fromCard}
      </div>
      {/* Back of card (transforming to) */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br from-green-500/20 to-green-500/5 border border-green-500/30 rounded',
          'flex items-center justify-center text-2xl',
          phase !== 'flipping' && 'opacity-0 rotate-y-180'
        )}
      >
        {toCard}
      </div>
    </div>
  );
}

// Token creation effect
interface TokenEffectProps {
  show: boolean;
  onComplete?: () => void;
  className?: string;
}

export function TokenEffect({ show, onComplete, className }: TokenEffectProps) {
  const [isVisible, setIsVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none',
        'flex items-center justify-center',
        'animate-bounce',
        className
      )}
    >
      <div className="w-16 h-16 rounded-full bg-green-500 shadow-lg flex items-center justify-center text-3xl animate-ping">
        🪙
      </div>
    </div>
  );
}

// Card draw effect (from library)
interface CardDrawEffectProps {
  show: boolean;
  onComplete?: () => void;
  className?: string;
}

export function CardDrawEffect({ show, onComplete, className }: CardDrawEffectProps) {
  const [isVisible, setIsVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        'absolute left-1/2 -translate-x-1/2 pointer-events-none',
        'flex items-center justify-center animate-slide-up',
        className
      )}
    >
      <div className="w-14 h-20 bg-blue-600 rounded shadow-lg flex items-center justify-center text-2xl animate-pulse">
        📤
      </div>
    </div>
  );
}

// Card discard/mill effect
interface CardMillEffectProps {
  show: boolean;
  count?: number;
  onComplete?: () => void;
  className?: string;
}

export function CardMillEffect({ show, count = 1, onComplete, className }: CardMillEffectProps) {
  const [isVisible, setIsVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        'absolute left-1/2 -translate-x-1/2 pointer-events-none',
        'flex items-center justify-center animate-slide-down',
        className
      )}
    >
      <div className="flex gap-1">
        {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
          <div
            key={i}
            className="w-12 h-16 bg-stone-700 rounded shadow-lg flex items-center justify-center text-xl animate-bounce"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            📚
          </div>
        ))}
      </div>
    </div>
  );
}
