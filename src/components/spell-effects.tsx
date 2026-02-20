'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

/**
 * Spell Effects System
 * 
 * Issue #290: Feature: Add spell casting visual effects
 * 
 * Provides:
 * - Spell casting animations with color-coded effects by card type
 * - Stack resolution effects with visual feedback
 * - Visual feedback for different spell types (instant, sorcery, enchantment, etc.)
 * - Counter spell and ability animations
 * - Transform and token creation effects
 * - Draw, discard, and mill animations
 */

// Spell effect types
export type SpellEffectType = 
  | 'cast' 
  | 'resolve' 
  | 'counter' 
  | 'transform' 
  | 'token'
  | 'draw'
  | 'discard'
  | 'mill'
  | 'sacrifice'
  | 'exile'
  | 'return'
  | 'copy'
  | 'scry'
  | 'shuffle';

// MTG color types for visual theming
export type SpellColor = 'blue' | 'red' | 'green' | 'black' | 'white' | 'colorless' | 'multicolor';

// Card types for different visual effects
export type CardType = 'instant' | 'sorcery' | 'enchantment' | 'artifact' | 'creature' | 'planeswalker' | 'land' | 'battle';

export interface SpellEvent {
  id: string;
  type: SpellEffectType;
  color?: SpellColor;
  cardType?: CardType;
  cardName?: string;
  cardImage?: string;
  amount?: number;
  timestamp: number;
  position?: { x: number; y: number };
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

// Color configurations for visual theming
const COLOR_CONFIG: Record<SpellColor, { 
  primary: string; 
  secondary: string; 
  glow: string;
  particles: string;
}> = {
  blue: {
    primary: 'bg-blue-500',
    secondary: 'from-blue-600 to-blue-400',
    glow: 'shadow-blue-500/50',
    particles: 'bg-blue-300',
  },
  red: {
    primary: 'bg-red-500',
    secondary: 'from-red-600 to-red-400',
    glow: 'shadow-red-500/50',
    particles: 'bg-red-300',
  },
  green: {
    primary: 'bg-green-500',
    secondary: 'from-green-600 to-green-400',
    glow: 'shadow-green-500/50',
    particles: 'bg-green-300',
  },
  black: {
    primary: 'bg-gray-800',
    secondary: 'from-gray-900 to-gray-700',
    glow: 'shadow-gray-800/50',
    particles: 'bg-gray-500',
  },
  white: {
    primary: 'bg-yellow-100',
    secondary: 'from-yellow-200 to-white',
    glow: 'shadow-yellow-100/50',
    particles: 'bg-yellow-50',
  },
  colorless: {
    primary: 'bg-gray-400',
    secondary: 'from-gray-500 to-gray-300',
    glow: 'shadow-gray-400/50',
    particles: 'bg-gray-200',
  },
  multicolor: {
    primary: 'bg-gradient-to-r from-red-500 via-green-500 to-blue-500',
    secondary: 'from-purple-600 to-pink-400',
    glow: 'shadow-purple-500/50',
    particles: 'bg-purple-300',
  },
};

// Card type configurations
const CARD_TYPE_CONFIG: Record<CardType, { icon: string; animation: string }> = {
  instant: { icon: '⚡', animation: 'animate-pulse' },
  sorcery: { icon: '✨', animation: 'animate-bounce' },
  enchantment: { icon: '🌟', animation: 'animate-spin-slow' },
  artifact: { icon: '⚙️', animation: 'animate-spin' },
  creature: { icon: '🐾', animation: 'animate-bounce' },
  planeswalker: { icon: '🔮', animation: 'animate-pulse' },
  land: { icon: '🌍', animation: 'animate-none' },
  battle: { icon: '⚔️', animation: 'animate-shake' },
};

// Particle component for spell effects
interface ParticleProps {
  color: SpellColor;
  delay: number;
  angle: number;
  distance: number;
}

function SpellParticle({ color, delay, angle, distance }: ParticleProps) {
  const colorConfig = COLOR_CONFIG[color];
  
  return (
    <div
      className={cn(
        'absolute w-2 h-2 rounded-full opacity-0',
        colorConfig.particles
      )}
      style={{
        animation: `particle-burst 0.8s ease-out ${delay}ms forwards`,
        '--angle': `${angle}deg`,
        '--distance': `${distance}px`,
      } as React.CSSProperties}
    />
  );
}

// Spell cast animation component
export function SpellCastEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'start' | 'charging' | 'burst' | 'fade'>('start');
  const [scale, setScale] = useState(0.3);
  const [opacity, setOpacity] = useState(0);
  const [rotation, setRotation] = useState(0);
  
  const colorConfig = COLOR_CONFIG[event.color || 'colorless'];
  const typeConfig = CARD_TYPE_CONFIG[event.cardType || 'instant'];

  useEffect(() => {
    // Start phase - appear and start charging
    const startTimer = setTimeout(() => {
      setPhase('charging');
      setOpacity(1);
      setScale(0.5);
    }, 50);

    // Charging phase - grow and rotate
    const chargingTimer = setTimeout(() => {
      setScale(1);
      setRotation(180);
    }, 200);

    // Burst phase - flash and expand
    const burstTimer = setTimeout(() => {
      setPhase('burst');
      setScale(1.5);
      setOpacity(0.8);
    }, 500);

    // Fade phase - disappear
    const fadeTimer = setTimeout(() => {
      setPhase('fade');
      setScale(2);
      setOpacity(0);
      onComplete?.(event.id);
    }, 800);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(chargingTimer);
      clearTimeout(burstTimer);
      clearTimeout(fadeTimer);
    };
  }, [event.id, onComplete]);

  const getEffectIcon = () => {
    switch (event.type) {
      case 'cast':
        return typeConfig.icon;
      case 'resolve':
        return '✅';
      case 'counter':
        return '🚫';
      case 'transform':
        return '🔄';
      case 'token':
        return '🪙';
      case 'copy':
        return '📋';
      default:
        return typeConfig.icon;
    }
  };

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none z-50',
        className
      )}
    >
      {/* Outer glow ring */}
      <div
        className={cn(
          'absolute inset-0 rounded-full blur-xl',
          colorConfig.primary,
          phase === 'charging' && 'animate-ping'
        )}
        style={{
          width: 120,
          height: 120,
          transform: `translate(-50%, -50%) scale(${scale})`,
          opacity: opacity * 0.5,
        }}
      />
      
      {/* Main spell effect */}
      <div
        className={cn(
          'relative flex items-center justify-center rounded-full',
          `bg-gradient-to-br ${colorConfig.secondary}`,
          'border-2 border-white/30',
          `shadow-lg ${colorConfig.glow}`,
          typeConfig.animation
        )}
        style={{
          width: 100,
          height: 100,
          transform: `scale(${scale}) rotate(${rotation}deg)`,
          opacity,
          transition: 'all 0.3s ease-out',
        }}
      >
        <span className="text-4xl filter drop-shadow-lg">{getEffectIcon()}</span>
      </div>
      
      {/* Particle burst */}
      {phase === 'burst' && (
        <div className="absolute inset-0">
          {Array.from({ length: 12 }).map((_, i) => (
            <SpellParticle
              key={i}
              color={event.color || 'colorless'}
              delay={i * 30}
              angle={i * 30}
              distance={80 + (i % 3) * 20}
            />
          ))}
        </div>
      )}
      
      {/* Card name label */}
      {event.cardName && phase !== 'fade' && (
        <div
          className={cn(
            'absolute top-full mt-2 left-1/2 -translate-x-1/2',
            'bg-black/80 text-white px-3 py-1 rounded text-sm font-medium',
            'whitespace-nowrap'
          )}
          style={{ opacity }}
        >
          {event.cardName}
        </div>
      )}
    </div>
  );
}

// Counter spell effect
export function CounterSpellEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'appear' | 'counter' | 'shatter' | 'fade'>('appear');
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number }>>([]);

  useEffect(() => {
    const appearTimer = setTimeout(() => setPhase('counter'), 100);
    const counterTimer = setTimeout(() => {
      setPhase('shatter');
      // Generate shatter particles
      setParticles(Array.from({ length: 16 }).map((_, i) => ({
        id: i,
        x: Math.cos(i * 22.5 * Math.PI / 180) * 50,
        y: Math.sin(i * 22.5 * Math.PI / 180) * 50,
      })));
    }, 400);
    const fadeTimer = setTimeout(() => {
      setPhase('fade');
      onComplete?.(event.id);
    }, 800);

    return () => {
      clearTimeout(appearTimer);
      clearTimeout(counterTimer);
      clearTimeout(fadeTimer);
    };
  }, [event.id, onComplete]);

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50',
        className
      )}
    >
      {/* Counter symbol */}
      <div
        className={cn(
          'relative w-24 h-24 flex items-center justify-center',
          'transition-all duration-300'
        )}
        style={{
          transform: phase === 'counter' ? 'scale(1.2)' : phase === 'shatter' ? 'scale(0)' : 'scale(1)',
          opacity: phase === 'fade' ? 0 : 1,
        }}
      >
        <div className="absolute inset-0 bg-red-600 rounded-full animate-pulse" />
        <div className="absolute inset-2 bg-red-800 rounded-full" />
        <span className="text-4xl z-10">🚫</span>
      </div>
      
      {/* Shatter particles */}
      {phase === 'shatter' && particles.map((p) => (
        <div
          key={p.id}
          className="absolute w-3 h-3 bg-red-400 rounded-sm"
          style={{
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
            animation: 'shatter-particle 0.5s ease-out forwards',
          }}
        />
      ))}
      
      {/* Counter text */}
      {event.cardName && (
        <div className="absolute top-full mt-4 left-1/2 -translate-x-1/2 bg-red-900/90 text-white px-4 py-2 rounded font-bold">
          COUNTERED: {event.cardName}
        </div>
      )}
    </div>
  );
}

// Card draw effect
export function CardDrawEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'draw' | 'reveal' | 'done'>('draw');
  const [position, setPosition] = useState(0);

  useEffect(() => {
    // Animate card moving from library to hand
    const drawTimer = setTimeout(() => {
      setPhase('reveal');
      setPosition(100);
    }, 200);
    
    const revealTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.(event.id);
    }, 600);

    return () => {
      clearTimeout(drawTimer);
      clearTimeout(revealTimer);
    };
  }, [event.id, onComplete]);

  const drawCount = event.amount || 1;

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/3 pointer-events-none z-50',
        className
      )}
    >
      {/* Card(s) moving from library to hand */}
      <div
        className="relative transition-all duration-300 ease-out"
        style={{
          transform: `translateY(${position}px)`,
          opacity: phase === 'done' ? 0 : 1,
        }}
      >
        {Array.from({ length: Math.min(drawCount, 3) }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'absolute w-14 h-20 bg-gradient-to-br from-blue-600 to-blue-400',
              'rounded shadow-lg border border-blue-300',
              'flex items-center justify-center'
            )}
            style={{
              left: i * 20 - 20,
              top: -i * 5,
              zIndex: i,
              transform: `rotate(${(i - 1) * 5}deg)`,
            }}
          >
            <span className="text-2xl">📤</span>
          </div>
        ))}
        
        {/* Draw count indicator */}
        {drawCount > 1 && (
          <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
            x{drawCount}
          </div>
        )}
      </div>
      
      {/* Draw text */}
      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-blue-900/90 text-white px-3 py-1 rounded text-sm">
        Draw {drawCount} card{drawCount > 1 ? 's' : ''}
      </div>
    </div>
  );
}

// Discard/mill effect
export function DiscardMillEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'start' | 'drop' | 'fade'>('start');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const dropTimer = setTimeout(() => {
      setPhase('drop');
      setOffset(150);
    }, 100);
    
    const fadeTimer = setTimeout(() => {
      setPhase('fade');
      onComplete?.(event.id);
    }, 500);

    return () => {
      clearTimeout(dropTimer);
      clearTimeout(fadeTimer);
    };
  }, [event.id, onComplete]);

  const count = event.amount || 1;
  const isMill = event.type === 'mill';

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/3 pointer-events-none z-50',
        className
      )}
    >
      {/* Cards dropping */}
      <div
        className="relative transition-all duration-400 ease-in"
        style={{
          transform: `translateY(${offset}px)`,
          opacity: phase === 'fade' ? 0 : 1,
        }}
      >
        {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'absolute w-12 h-16 rounded shadow-lg',
              isMill ? 'bg-stone-700' : 'bg-gray-600',
              'flex items-center justify-center'
            )}
            style={{
              left: i * 15 - 30,
              top: -i * 3,
              transform: `rotate(${(i - 2) * 8}deg)`,
              animationDelay: `${i * 50}ms`,
            }}
          >
            <span className="text-xl">{isMill ? '📚' : '🗑️'}</span>
          </div>
        ))}
      </div>
      
      {/* Action text */}
      <div className={cn(
        'absolute top-full mt-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded text-sm text-white',
        isMill ? 'bg-stone-800' : 'bg-gray-800'
      )}>
        {isMill ? 'Mill' : 'Discard'} {count} card{count > 1 ? 's' : ''}
      </div>
    </div>
  );
}

// Token creation effect
export function TokenEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'spawn' | 'grow' | 'settle' | 'done'>('spawn');
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const spawnTimer = setTimeout(() => {
      setPhase('grow');
      setScale(1.2);
    }, 100);
    
    const growTimer = setTimeout(() => {
      setPhase('settle');
      setScale(1);
    }, 300);
    
    const doneTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.(event.id);
    }, 800);

    return () => {
      clearTimeout(spawnTimer);
      clearTimeout(growTimer);
      clearTimeout(doneTimer);
    };
  }, [event.id, onComplete]);

  const count = event.amount || 1;

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50',
        className
      )}
    >
      {/* Token spawn effect */}
      <div
        className={cn(
          'relative transition-all duration-300 ease-out',
          'flex items-center justify-center'
        )}
        style={{
          transform: `scale(${scale})`,
          opacity: phase === 'done' ? 0 : 1,
        }}
      >
        {/* Glow background */}
        <div className="absolute inset-0 bg-green-500/30 rounded-full blur-xl animate-pulse" />
        
        {/* Token representation */}
        <div className={cn(
          'relative w-16 h-20 bg-gradient-to-br from-green-600 to-green-400',
          'rounded-lg shadow-lg border-2 border-green-300',
          'flex flex-col items-center justify-center'
        )}>
          <span className="text-2xl">🪙</span>
          <span className="text-xs text-white font-bold">TOKEN</span>
        </div>
        
        {/* Sparkle effects */}
        {phase === 'grow' && (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="absolute w-2 h-2 bg-yellow-300 rounded-full animate-ping"
                style={{
                  transform: `rotate(${i * 60}deg) translateX(40px)`,
                }}
              />
            ))}
          </>
        )}
      </div>
      
      {/* Token count */}
      {count > 1 && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white text-sm font-bold px-2 py-0.5 rounded-full">
          x{count}
        </div>
      )}
      
      {/* Token name */}
      {event.cardName && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-green-900/90 text-white px-3 py-1 rounded text-sm">
          Create: {event.cardName}
        </div>
      )}
    </div>
  );
}

// Transform effect
export function TransformEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'start' | 'flip' | 'reveal' | 'done'>('start');
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const flipTimer = setTimeout(() => {
      setPhase('flip');
      setRotation(180);
    }, 100);
    
    const revealTimer = setTimeout(() => {
      setPhase('reveal');
      setRotation(360);
    }, 400);
    
    const doneTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.(event.id);
    }, 700);

    return () => {
      clearTimeout(flipTimer);
      clearTimeout(revealTimer);
      clearTimeout(doneTimer);
    };
  }, [event.id, onComplete]);

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50',
        className
      )}
    >
      <div
        className="relative w-20 h-28 transition-transform duration-500"
        style={{
          transform: `rotateY(${rotation}deg)`,
          opacity: phase === 'done' ? 0 : 1,
        }}
      >
        {/* Front (before transform) */}
        <div
          className={cn(
            'absolute inset-0 backface-hidden',
            'bg-gradient-to-br from-purple-600 to-purple-400 rounded-lg',
            'flex items-center justify-center border-2 border-purple-300'
          )}
        >
          <span className="text-3xl">🔄</span>
        </div>
        
        {/* Back (after transform) */}
        <div
          className={cn(
            'absolute inset-0 backface-hidden rotate-y-180',
            'bg-gradient-to-br from-green-600 to-green-400 rounded-lg',
            'flex items-center justify-center border-2 border-green-300'
          )}
        >
          <span className="text-3xl">✨</span>
        </div>
      </div>
      
      {/* Transform text */}
      {event.cardName && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-purple-900/90 text-white px-3 py-1 rounded text-sm">
          Transform → {event.cardName}
        </div>
      )}
    </div>
  );
}

// Sacrifice effect
export function SacrificeEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'start' | 'crumble' | 'fade'>('start');
  const [particles, setParticles] = useState<Array<{ id: number; delay: number }>>([]);

  useEffect(() => {
    const crumbleTimer = setTimeout(() => {
      setPhase('crumble');
      setParticles(Array.from({ length: 12 }).map((_, i) => ({ id: i, delay: i * 50 })));
    }, 100);
    
    const fadeTimer = setTimeout(() => {
      setPhase('fade');
      onComplete?.(event.id);
    }, 600);

    return () => {
      clearTimeout(crumbleTimer);
      clearTimeout(fadeTimer);
    };
  }, [event.id, onComplete]);

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50',
        className
      )}
    >
      {/* Crumbling card */}
      <div
        className={cn(
          'relative w-16 h-20 transition-all duration-300',
          phase === 'crumble' && 'opacity-50',
          phase === 'fade' && 'opacity-0'
        )}
      >
        <div className="w-full h-full bg-gradient-to-br from-orange-700 to-orange-500 rounded-lg border border-orange-400 flex items-center justify-center">
          <span className="text-2xl">💀</span>
        </div>
        
        {/* Crumble particles */}
        {phase === 'crumble' && particles.map((p) => (
          <div
            key={p.id}
            className="absolute w-2 h-2 bg-orange-400 rounded-sm"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `fall-down 0.5s ease-in ${p.delay}ms forwards`,
            }}
          />
        ))}
      </div>
      
      {/* Sacrifice text */}
      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-orange-900/90 text-white px-3 py-1 rounded text-sm">
        Sacrifice {event.cardName || 'creature'}
      </div>
    </div>
  );
}

// Exile effect
export function ExileEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'start' | 'warp' | 'banish' | 'done'>('start');
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const warpTimer = setTimeout(() => {
      setPhase('warp');
      setScale(0.8);
    }, 100);
    
    const banishTimer = setTimeout(() => {
      setPhase('banish');
      setScale(0);
    }, 300);
    
    const doneTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.(event.id);
    }, 600);

    return () => {
      clearTimeout(warpTimer);
      clearTimeout(banishTimer);
      clearTimeout(doneTimer);
    };
  }, [event.id, onComplete]);

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50',
        className
      )}
    >
      {/* Warping card */}
      <div
        className="relative transition-all duration-300"
        style={{
          transform: `scale(${scale})`,
          opacity: phase === 'done' ? 0 : 1,
        }}
      >
        {/* Warp effect */}
        <div className={cn(
          'absolute inset-0 bg-sky-500/50 rounded-lg blur-md',
          phase === 'warp' && 'animate-pulse'
        )} />
        
        <div className="w-16 h-20 bg-gradient-to-br from-sky-700 to-sky-500 rounded-lg border border-sky-400 flex items-center justify-center">
          <span className="text-2xl">🌀</span>
        </div>
        
        {/* Spiral effect */}
        {phase === 'banish' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-24 h-24 border-4 border-sky-300 rounded-full animate-spin" />
          </div>
        )}
      </div>
      
      {/* Exile text */}
      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-sky-900/90 text-white px-3 py-1 rounded text-sm">
        Exile {event.cardName || 'permanent'}
      </div>
    </div>
  );
}

// Scry effect
export function ScryEffect({ event, onComplete, className }: SpellEffectProps) {
  const [phase, setPhase] = useState<'reveal' | 'arrange' | 'done'>('reveal');
  const [topCards, setTopCards] = useState<Array<{ id: number; keep: boolean | null }>>([]);

  useEffect(() => {
    const amount = event.amount || 1;
    setTopCards(Array.from({ length: amount }).map((_, i) => ({ id: i, keep: null })));
    
    const arrangeTimer = setTimeout(() => setPhase('arrange'), 300);
    const doneTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.(event.id);
    }, 1000);

    return () => {
      clearTimeout(arrangeTimer);
      clearTimeout(doneTimer);
    };
  }, [event.id, event.amount, onComplete]);

  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50',
        className
      )}
    >
      <div
        className="relative transition-all duration-300"
        style={{ opacity: phase === 'done' ? 0 : 1 }}
      >
        {/* Scry indicator */}
        <div className="flex gap-2">
          {topCards.map((card) => (
            <div
              key={card.id}
              className={cn(
                'w-12 h-16 bg-gradient-to-br from-purple-600 to-purple-400',
                'rounded shadow-lg border border-purple-300',
                'flex items-center justify-center',
                'animate-bounce'
              )}
              style={{ animationDelay: `${card.id * 100}ms` }}
            >
              <span className="text-lg">👁️</span>
            </div>
          ))}
        </div>
        
        {/* Scry text */}
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-purple-900/90 text-white px-3 py-1 rounded text-sm whitespace-nowrap">
          Scry {event.amount || 1}
        </div>
      </div>
    </div>
  );
}

// Main spell effect component that routes to specific effect types
export function SpellEffect({ event, onComplete, className }: SpellEffectProps) {
  switch (event.type) {
    case 'cast':
    case 'resolve':
    case 'copy':
      return <SpellCastEffect event={event} onComplete={onComplete} className={className} />;
    case 'counter':
      return <CounterSpellEffect event={event} onComplete={onComplete} className={className} />;
    case 'draw':
      return <CardDrawEffect event={event} onComplete={onComplete} className={className} />;
    case 'discard':
    case 'mill':
      return <DiscardMillEffect event={event} onComplete={onComplete} className={className} />;
    case 'token':
      return <TokenEffect event={event} onComplete={onComplete} className={className} />;
    case 'transform':
      return <TransformEffect event={event} onComplete={onComplete} className={className} />;
    case 'sacrifice':
      return <SacrificeEffect event={event} onComplete={onComplete} className={className} />;
    case 'exile':
      return <ExileEffect event={event} onComplete={onComplete} className={className} />;
    case 'scry':
      return <ScryEffect event={event} onComplete={onComplete} className={className} />;
    default:
      return <SpellCastEffect event={event} onComplete={onComplete} className={className} />;
  }
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
  triggerSpell: (type: SpellEffectType, color?: SpellColor, cardType?: CardType, cardName?: string, amount?: number) => void;
  triggerCast: (cardName: string, color: SpellColor, cardType: CardType) => void;
  triggerCounter: (cardName: string) => void;
  triggerDraw: (amount: number) => void;
  triggerDiscard: (amount: number) => void;
  triggerMill: (amount: number) => void;
  triggerToken: (cardName: string, amount: number) => void;
  triggerTransform: (cardName: string) => void;
  triggerSacrifice: (cardName: string) => void;
  triggerExile: (cardName: string) => void;
  triggerScry: (amount: number) => void;
  clearEvents: () => void;
}

export function useSpellEvents({ maxEvents = 5 }: UseSpellEventsOptions = {}): UseSpellEventsReturn {
  const [events, setEvents] = useState<SpellEvent[]>([]);

  const addEvent = useCallback((type: SpellEffectType, options?: {
    color?: SpellColor;
    cardType?: CardType;
    cardName?: string;
    amount?: number;
  }) => {
    const newEvent: SpellEvent = {
      id: `spell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      ...options,
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

  const triggerSpell = useCallback((type: SpellEffectType, color?: SpellColor, cardType?: CardType, cardName?: string, amount?: number) => {
    addEvent(type, { color, cardType, cardName, amount });
  }, [addEvent]);

  const triggerCast = useCallback((cardName: string, color: SpellColor, cardType: CardType) => {
    addEvent('cast', { cardName, color, cardType });
  }, [addEvent]);

  const triggerCounter = useCallback((cardName: string) => {
    addEvent('counter', { cardName });
  }, [addEvent]);

  const triggerDraw = useCallback((amount: number) => {
    addEvent('draw', { amount });
  }, [addEvent]);

  const triggerDiscard = useCallback((amount: number) => {
    addEvent('discard', { amount });
  }, [addEvent]);

  const triggerMill = useCallback((amount: number) => {
    addEvent('mill', { amount });
  }, [addEvent]);

  const triggerToken = useCallback((cardName: string, amount: number) => {
    addEvent('token', { cardName, amount });
  }, [addEvent]);

  const triggerTransform = useCallback((cardName: string) => {
    addEvent('transform', { cardName });
  }, [addEvent]);

  const triggerSacrifice = useCallback((cardName: string) => {
    addEvent('sacrifice', { cardName });
  }, [addEvent]);

  const triggerExile = useCallback((cardName: string) => {
    addEvent('exile', { cardName });
  }, [addEvent]);

  const triggerScry = useCallback((amount: number) => {
    addEvent('scry', { amount });
  }, [addEvent]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    triggerSpell,
    triggerCast,
    triggerCounter,
    triggerDraw,
    triggerDiscard,
    triggerMill,
    triggerToken,
    triggerTransform,
    triggerSacrifice,
    triggerExile,
    triggerScry,
    clearEvents,
  };
}

// Stack display component with spell effects
interface StackItem {
  id: string;
  name: string;
  type: CardType;
  color: SpellColor;
  controller: string;
}

interface SpellStackProps {
  items: StackItem[];
  onResolve?: (itemId: string) => void;
  className?: string;
}

export function SpellStack({ items, onResolve, className }: SpellStackProps) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const handleResolve = useCallback((itemId: string) => {
    setResolvingId(itemId);
    setTimeout(() => {
      onResolve?.(itemId);
      setResolvingId(null);
    }, 500);
  }, [onResolve]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {items.map((item, index) => (
        <div
          key={item.id}
          className={cn(
            'relative p-3 rounded-lg border-2 transition-all duration-300',
            `bg-gradient-to-r ${COLOR_CONFIG[item.color].secondary}`,
            index === items.length - 1 ? 'border-white/50' : 'border-white/20',
            resolvingId === item.id && 'animate-pulse scale-105'
          )}
          onClick={() => index === items.length - 1 && handleResolve(item.id)}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">{CARD_TYPE_CONFIG[item.type].icon}</span>
            <div className="flex flex-col">
              <span className="font-medium text-white text-sm">{item.name}</span>
              <span className="text-xs text-white/70">{item.controller}</span>
            </div>
          </div>
          
          {/* Top of stack indicator */}
          {index === items.length - 1 && (
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-white text-black text-xs px-2 py-0.5 rounded">
              TOP
            </div>
          )}
        </div>
      ))}
      
      {items.length === 0 && (
        <div className="text-center text-muted-foreground text-sm py-4">
          Stack is empty
        </div>
      )}
    </div>
  );
}

export default SpellEffects;