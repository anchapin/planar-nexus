'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

// Combat action types
export type CombatActionType = 'attack' | 'block' | 'damage' | 'lifelink' | 'trample';

export interface CombatAction {
  id: string;
  type: CombatActionType;
  sourceId: string;
  sourceName: string;
  targetId?: string;
  targetName?: string;
  amount?: number;
  timestamp: number;
}

interface CombatAnimationProps {
  action: CombatAction;
  onComplete?: (id: string) => void;
  className?: string;
}

interface CombatAnimationsProps {
  actions: CombatAction[];
  onActionComplete?: (id: string) => void;
  className?: string;
}

// Attack animation component
export function CombatAnimation({ action, onComplete, className }: CombatAnimationProps) {
  const [phase, setPhase] = useState<'idle' | 'attack' | 'impact' | 'recoil' | 'complete'>('idle');
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    // Start attack animation
    const attackTimer = setTimeout(() => setPhase('attack'), 50);
    
    // Impact phase
    const impactTimer = setTimeout(() => {
      setPhase('impact');
      if (action.type === 'damage' && action.amount) {
        setPosition({ x: 0, y: 0 });
      }
    }, 400);
    
    // Recoil phase
    const recoilTimer = setTimeout(() => {
      setPhase('recoil');
    }, 600);
    
    // Complete
    const completeTimer = setTimeout(() => {
      setPhase('complete');
      onComplete?.(action.id);
    }, 900);

    return () => {
      clearTimeout(attackTimer);
      clearTimeout(impactTimer);
      clearTimeout(recoilTimer);
      clearTimeout(completeTimer);
    };
  }, [action.id, action.amount, action.type, onComplete]);

  const getAnimationStyle = () => {
    switch (phase) {
      case 'attack':
        return { transform: 'translateX(50px)', opacity: 1 };
      case 'impact':
        return { transform: 'translateX(30px)', opacity: 1 };
      case 'recoil':
        return { transform: 'translateX(-10px)', opacity: 1 };
      case 'complete':
        return { transform: 'translateX(0)', opacity: 0 };
      default:
        return { transform: 'translateX(0)', opacity: 1 };
    }
  };

  const getIcon = () => {
    switch (action.type) {
      case 'attack':
        return '⚔️';
      case 'block':
        return '🛡️';
      case 'damage':
        return '💥';
      case 'lifelink':
        return '💚';
      case 'trample':
        return '👊';
      default:
        return '⚔️';
    }
  };

  if (phase === 'complete') return null;

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none',
        'flex flex-col items-center justify-center',
        className
      )}
      style={{
        ...getAnimationStyle(),
        transition: 'all 0.3s ease-out',
      }}
    >
      {/* Attacker indicator */}
      <div className="flex items-center gap-2 bg-card border rounded-lg px-3 py-2 shadow-lg">
        <span className="text-xl">{getIcon()}</span>
        <span className="font-medium text-sm">{action.sourceName}</span>
        {action.amount && action.type === 'damage' && (
          <span className="font-bold text-red-500 text-lg">-{action.amount}</span>
        )}
        {action.amount && action.type === 'lifelink' && (
          <span className="font-bold text-green-500 text-lg">+{action.amount}</span>
        )}
        {action.targetName && (
          <span className="text-muted-foreground text-sm">→ {action.targetName}</span>
        )}
      </div>
    </div>
  );
}

// Overlay for combat animations
export function CombatAnimations({ actions, onActionComplete, className }: CombatAnimationsProps) {
  const handleComplete = useCallback((id: string) => {
    onActionComplete?.(id);
  }, [onActionComplete]);

  return (
    <div className={cn('absolute inset-0 pointer-events-none overflow-hidden', className)}>
      {actions.map((action) => (
        <CombatAnimation
          key={action.id}
          action={action}
          onComplete={handleComplete}
        />
      ))}
    </div>
  );
}

// Hook for managing combat actions
interface UseCombatActionsOptions {
  maxActions?: number;
}

interface UseCombatActionsReturn {
  actions: CombatAction[];
  triggerAttack: (sourceId: string, sourceName: string, targetId?: string, targetName?: string) => void;
  triggerBlock: (sourceId: string, sourceName: string) => void;
  triggerDamage: (sourceId: string, sourceName: string, amount: number, targetId?: string, targetName?: string) => void;
  triggerLifelink: (sourceId: string, sourceName: string, amount: number) => void;
  clearActions: () => void;
}

export function useCombatActions({ maxActions = 5 }: UseCombatActionsOptions = {}): UseCombatActionsReturn {
  const [actions, setActions] = useState<CombatAction[]>([]);

  const triggerAttack = useCallback((sourceId: string, sourceName: string, targetId?: string, targetName?: string) => {
    const newAction: CombatAction = {
      id: `combat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'attack',
      sourceId,
      sourceName,
      targetId,
      targetName,
      timestamp: Date.now(),
    };
    setActions((prev) => [...prev, newAction].slice(-maxActions));
  }, [maxActions]);

  const triggerBlock = useCallback((sourceId: string, sourceName: string) => {
    const newAction: CombatAction = {
      id: `combat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'block',
      sourceId,
      sourceName,
      timestamp: Date.now(),
    };
    setActions((prev) => [...prev, newAction].slice(-maxActions));
  }, [maxActions]);

  const triggerDamage = useCallback((sourceId: string, sourceName: string, amount: number, targetId?: string, targetName?: string) => {
    const newAction: CombatAction = {
      id: `combat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'damage',
      sourceId,
      sourceName,
      targetId,
      targetName,
      amount,
      timestamp: Date.now(),
    };
    setActions((prev) => [...prev, newAction].slice(-maxActions));
  }, [maxActions]);

  const triggerLifelink = useCallback((sourceId: string, sourceName: string, amount: number) => {
    const newAction: CombatAction = {
      id: `combat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'lifelink',
      sourceId,
      sourceName,
      amount,
      timestamp: Date.now(),
    };
    setActions((prev) => [...prev, newAction].slice(-maxActions));
  }, [maxActions]);

  const clearActions = useCallback(() => {
    setActions([]);
  }, []);

  const handleActionComplete = useCallback((id: string) => {
    setActions((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return {
    actions,
    triggerAttack,
    triggerBlock,
    triggerDamage,
    triggerLifelink,
    clearActions,
  };
}

// Attack/Block card component for the battlefield
interface CombatCardProps {
  cardId: string;
  cardName: string;
  power?: number;
  toughness?: number;
  isAttacking?: boolean;
  isBlocking?: boolean;
  hasDealtDamage?: boolean;
  isTapped?: boolean;
  onTap?: () => void;
  className?: string;
}

export function CombatCard({
  cardId,
  cardName,
  power = 0,
  toughness = 0,
  isAttacking = false,
  isBlocking = false,
  hasDealtDamage = false,
  isTapped = false,
  onTap,
  className,
}: CombatCardProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isAttacking || isBlocking) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isAttacking, isBlocking]);

  return (
    <div
      className={cn(
        'relative w-16 h-24 bg-gradient-to-br from-primary/20 to-primary/5 border-2 rounded-lg',
        'flex flex-col items-center justify-between p-1 cursor-pointer transition-all',
        isTapped && 'rotate-90',
        isAttacking && 'border-red-500 shadow-lg shadow-red-500/30 animate-pulse',
        isBlocking && 'border-blue-500 shadow-lg shadow-blue-500/30',
        hasDealtDamage && 'opacity-60',
        isAnimating && 'animate-bounce',
        className
      )}
      onClick={onTap}
    >
      {/* Card name */}
      <span className="text-[8px] font-medium truncate w-full text-center">{cardName}</span>
      
      {/* Power/Toughness */}
      <div className="flex items-center justify-center gap-1">
        <span className={cn(
          'text-xs font-bold',
          power > toughness ? 'text-green-500' : 'text-red-500'
        )}>
          {power}
        </span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs font-bold">{toughness}</span>
      </div>
      
      {/* Attack/Block indicators */}
      {isAttacking && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs">
          ⚔️
        </div>
      )}
      {isBlocking && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">
          🛡️
        </div>
      )}
    </div>
  );
}

// Combat phase indicator
interface CombatPhaseIndicatorProps {
  phase: 'declare-attackers' | 'declare-blockers' | 'combat-damage' | 'end';
  className?: string;
}

export function CombatPhaseIndicator({ phase, className }: CombatPhaseIndicatorProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(false), 2000);
    return () => clearTimeout(timer);
  }, [phase]);

  if (!isVisible) return null;

  const getPhaseText = () => {
    switch (phase) {
      case 'declare-attackers':
        return '⚔️ Declare Attackers';
      case 'declare-blockers':
        return '🛡️ Declare Blockers';
      case 'combat-damage':
        return '💥 Combat Damage';
      case 'end':
        return '✅ End of Combat';
      default:
        return '';
    }
  };

  return (
    <div
      className={cn(
        'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
        'bg-card/90 border border-border rounded-lg px-4 py-2 shadow-lg',
        'animate-fade-in-out pointer-events-none',
        className
      )}
    >
      <span className="font-semibold text-lg">{getPhaseText()}</span>
    </div>
  );
}
