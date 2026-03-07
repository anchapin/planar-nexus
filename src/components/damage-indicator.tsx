'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

export type DamageType = 'combat' | 'noncombat' | 'poison' | 'life' | 'heal';

export interface DamageEvent {
  id: string;
  amount: number;
  type: DamageType;
  sourceName?: string;
  targetId: string;
  timestamp: number;
}

interface DamageIndicatorProps {
  event: DamageEvent;
  onComplete?: (id: string) => void;
  className?: string;
}

export function DamageIndicator({ event, onComplete, className }: DamageIndicatorProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    // Animate the damage number floating up
    const animationTimer = setTimeout(() => {
      setOffset(-60);
    }, 50);

    // Fade out after animation
    const fadeTimer = setTimeout(() => {
      setIsVisible(false);
      onComplete?.(event.id);
    }, 1500);

    return () => {
      clearTimeout(animationTimer);
      clearTimeout(fadeTimer);
    };
  }, [event.id, onComplete]);

  const getColor = () => {
    switch (event.type) {
      case 'combat':
        return 'text-red-500';
      case 'noncombat':
        return 'text-orange-500';
      case 'poison':
        return 'text-purple-500';
      case 'life':
        return 'text-blue-500';
      case 'heal':
        return 'text-green-500';
      default:
        return 'text-red-500';
    }
  };

  const getIcon = () => {
    switch (event.type) {
      case 'combat':
        return '⚔️';
      case 'noncombat':
        return '🔥';
      case 'poison':
        return '☠️';
      case 'life':
        return '💔';
      case 'heal':
        return '💚';
      default:
        return '';
    }
  };

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        'absolute left-1/2 -translate-x-1/2 pointer-events-none select-none',
        'transition-all duration-500 ease-out',
        getColor(),
        className
      )}
      style={{
        transform: `translate(-50%, ${offset}px)`,
        opacity: isVisible ? 1 : 0,
      }}
    >
      <div className="flex flex-col items-center">
        <span className="text-3xl font-bold drop-shadow-lg" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}>
          {getIcon()} {event.amount}
        </span>
        {event.sourceName && (
          <span className="text-xs opacity-75">{event.sourceName}</span>
        )}
      </div>
    </div>
  );
}

interface DamageOverlayProps {
  events: DamageEvent[];
  onEventComplete?: (id: string) => void;
  className?: string;
}

export function DamageOverlay({ events, onEventComplete, className }: DamageOverlayProps) {
  const handleComplete = useCallback((id: string) => {
    onEventComplete?.(id);
  }, [onEventComplete]);

  return (
    <div className={cn('absolute inset-0 pointer-events-none overflow-hidden', className)}>
      {events.map((event) => (
        <DamageIndicator
          key={event.id}
          event={event}
          onComplete={handleComplete}
        />
      ))}
    </div>
  );
}

// Hook for managing damage events
interface UseDamageEventsOptions {
  maxEvents?: number;
}

interface UseDamageEventsReturn {
  events: DamageEvent[];
  addDamage: (amount: number, type: DamageType, targetId: string, sourceName?: string) => void;
  addHeal: (amount: number, targetId: string) => void;
  clearEvents: () => void;
}

export function useDamageEvents({ maxEvents = 10 }: UseDamageEventsOptions = {}): UseDamageEventsReturn {
  const [events, setEvents] = useState<DamageEvent[]>([]);

  const addDamage = useCallback((amount: number, type: DamageType, targetId: string, sourceName?: string) => {
    const newEvent: DamageEvent = {
      id: `dmg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      amount,
      type,
      targetId,
      sourceName,
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

  const addHeal = useCallback((amount: number, targetId: string) => {
    addDamage(amount, 'heal', targetId);
  }, [addDamage]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const handleEventComplete = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    events,
    addDamage,
    addHeal,
    clearEvents,
  };
}

// Life change display component for showing life total changes
interface LifeChangeDisplayProps {
  previousLife: number;
  currentLife: number;
  playerName: string;
  className?: string;
}

export function LifeChangeDisplay({ previousLife, currentLife, playerName, className }: LifeChangeDisplayProps) {
  const change = currentLife - previousLife;
  const [showChange, setShowChange] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowChange(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  if (change === 0) return null;

  return (
    <div className={cn('flex items-center gap-2 text-sm', className)}>
      <span className="text-muted-foreground">{playerName}:</span>
      <span className="font-mono">{previousLife}</span>
      {showChange && (
        <span className={cn('font-bold', change > 0 ? 'text-green-500' : 'text-red-500')}>
          {change > 0 ? `+${change}` : change}
        </span>
      )}
      <span className="font-mono font-bold">{currentLife}</span>
    </div>
  );
}
