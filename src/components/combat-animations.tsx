"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

/**
 * Combat Animation System
 *
 * Issue #289: Feature: Add attack/block animations
 *
 * Provides:
 * - Attack declaration animations with visual trails
 * - Block declaration animations with shield effects
 * - Combat damage animations with impact effects
 * - Smooth transitions between combat phases
 * - Support for first strike and double strike
 */

// Combat action types
export type CombatActionType =
  | "attack"
  | "block"
  | "damage"
  | "lifelink"
  | "trample"
  | "first-strike"
  | "double-strike"
  | "deathtouch"
  | "remove-from-combat";

export interface CombatAction {
  id: string;
  type: CombatActionType;
  sourceId: string;
  sourceName: string;
  sourcePosition?: { x: number; y: number };
  targetId?: string;
  targetName?: string;
  targetPosition?: { x: number; y: number };
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

// Animation phase types
type AnimationPhase =
  "idle" | "windup" | "strike" | "impact" | "recoil" | "fadeout";

// Attack animation with visual trail effect
export function AttackAnimation({
  action,
  onComplete,
  className,
}: CombatAnimationProps) {
  const [phase, setPhase] = useState<AnimationPhase>("idle");
  const [trailPositions, setTrailPositions] = useState<
    { x: number; y: number }[]
  >([]);
  const animationRef = useRef<number | undefined>(undefined);
  // #1103: skip the multi-phase motion sequence under reduced motion — show the
  // final state immediately and complete without trails / impact particles.
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      // #1103: show the attack indicator statically (peak state, no transforms —
      // see getAnimationStyle) for a short dwell so the event is communicated
      // without motion, then complete.
      setPhase("strike");
      const completeTimer = setTimeout(() => {
        onComplete?.(action.id);
      }, 300);
      return () => clearTimeout(completeTimer);
    }

    // Windup phase - prepare to attack
    const windupTimer = setTimeout(() => setPhase("windup"), 50);

    // Strike phase - move towards target
    const strikeTimer = setTimeout(() => {
      setPhase("strike");
      // Create trail effect
      const trailInterval = setInterval(() => {
        setTrailPositions((prev) => prev.slice(-5));
      }, 50);
      animationRef.current = trailInterval as unknown as number;
    }, 200);

    // Impact phase - hit target
    const impactTimer = setTimeout(() => {
      setPhase("impact");
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    }, 400);

    // Recoil phase - pull back
    const recoilTimer = setTimeout(() => setPhase("recoil"), 600);

    // Fadeout phase - disappear
    const fadeoutTimer = setTimeout(() => setPhase("fadeout"), 800);

    // Complete
    const completeTimer = setTimeout(() => {
      onComplete?.(action.id);
    }, 1000);

    return () => {
      clearTimeout(windupTimer);
      clearTimeout(strikeTimer);
      clearTimeout(impactTimer);
      clearTimeout(recoilTimer);
      clearTimeout(fadeoutTimer);
      clearTimeout(completeTimer);
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, [action.id, onComplete, reduceMotion]);

  const getAnimationStyle = (): React.CSSProperties => {
    // #1103: no transforms / filter animation under reduced motion.
    if (reduceMotion) {
      return phase === "fadeout" ? { opacity: 0 } : { opacity: 1 };
    }

    const baseStyle = { opacity: 1 };

    switch (phase) {
      case "windup":
        return {
          ...baseStyle,
          transform: "translateX(-30px) scale(1.1)",
          filter: "brightness(1.2)",
        };
      case "strike":
        return {
          ...baseStyle,
          transform: "translateX(80px) scale(1.2)",
          filter: "brightness(1.5)",
        };
      case "impact":
        return {
          ...baseStyle,
          transform: "translateX(60px) scale(1.3)",
          filter: "brightness(2)",
        };
      case "recoil":
        return {
          ...baseStyle,
          transform: "translateX(20px) scale(1.1)",
          filter: "brightness(1)",
        };
      case "fadeout":
        return {
          opacity: 0,
          transform: "translateX(0) scale(1)",
          filter: "brightness(1)",
        };
      default:
        return { ...baseStyle, transform: "translateX(0) scale(1)" };
    }
  };

  const getIcon = () => {
    switch (action.type) {
      case "attack":
        return "⚔️";
      case "first-strike":
        return "⚡";
      case "double-strike":
        return "⚡⚡";
      default:
        return "⚔️";
    }
  };

  if (phase === "idle") return null;

  return (
    <div
      className={cn(
        "absolute left-1/4 top-1/2 -translate-y-1/2 pointer-events-none select-none z-50",
        className,
      )}
    >
      {/* Trail effect — decorative, skipped under reduced motion (#1103) */}
      {!reduceMotion &&
        phase === "strike" &&
        trailPositions.map((pos, idx) => (
          <div
            key={idx}
            className="absolute w-8 h-8 bg-red-500/30 rounded-full blur-xs"
            style={{
              left: pos.x,
              top: pos.y,
              opacity: 0.5 - idx * 0.1,
            }}
          />
        ))}

      {/* Main attack indicator */}
      <div
        className={cn(
          "flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-500",
          "border-2 border-red-400 rounded-lg px-4 py-2 shadow-lg shadow-red-500/50",
          // #1103: drop the transition when motion is reduced.
          !reduceMotion && "transition-all duration-150 ease-out",
        )}
        style={getAnimationStyle()}
      >
        <span className={cn("text-2xl", !reduceMotion && "animate-pulse")}>
          {getIcon()}
        </span>
        <div className="flex flex-col">
          <span className="font-bold text-white text-sm">
            {action.sourceName}
          </span>
          <span className="text-red-200 text-xs">attacking!</span>
        </div>
      </div>

      {/* Impact particles — decorative, skipped under reduced motion (#1103) */}
      {!reduceMotion && phase === "impact" && (
        <div className="absolute left-full top-1/2 -translate-y-1/2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 bg-yellow-400 rounded-full animate-ping"
              style={{
                transform: `rotate(${i * 45}deg) translateX(20px)`,
                animationDelay: `${i * 25}ms`,
                animationDuration: "300ms",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Block animation with shield effect
export function BlockAnimation({
  action,
  onComplete,
  className,
}: CombatAnimationProps) {
  const [phase, setPhase] = useState<
    "idle" | "raise" | "block" | "hold" | "lower" | "complete"
  >("idle");
  // #1103: under reduced motion, skip the raise/block/hold/lower sequence and
  // present the static block indicator, completing on the next tick.
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      // #1103: show the block indicator statically (peak state, no transforms —
      // see getAnimationStyle) for a short dwell so the event is communicated
      // without motion, then complete.
      setPhase("block");
      const completeTimer = setTimeout(() => {
        onComplete?.(action.id);
      }, 300);
      return () => clearTimeout(completeTimer);
    }

    const raiseTimer = setTimeout(() => setPhase("raise"), 50);
    const blockTimer = setTimeout(() => setPhase("block"), 200);
    const holdTimer = setTimeout(() => setPhase("hold"), 400);
    const lowerTimer = setTimeout(() => setPhase("lower"), 800);
    const completeTimer = setTimeout(() => {
      setPhase("complete");
      onComplete?.(action.id);
    }, 1000);

    return () => {
      clearTimeout(raiseTimer);
      clearTimeout(blockTimer);
      clearTimeout(holdTimer);
      clearTimeout(lowerTimer);
      clearTimeout(completeTimer);
    };
  }, [action.id, onComplete, reduceMotion]);

  const getAnimationStyle = (): React.CSSProperties => {
    // #1103: no transforms / opacity ramp under reduced motion.
    if (reduceMotion) {
      return { transform: "scale(1)", opacity: 1 };
    }

    switch (phase) {
      case "raise":
        return { transform: "scale(0.8) translateY(20px)", opacity: 0.7 };
      case "block":
        return { transform: "scale(1.2) translateY(0)", opacity: 1 };
      case "hold":
        return { transform: "scale(1.1) translateY(0)", opacity: 1 };
      case "lower":
        return { transform: "scale(0.9) translateY(10px)", opacity: 0.5 };
      default:
        return { transform: "scale(1)", opacity: 1 };
    }
  };

  if (phase === "idle" || phase === "complete") return null;

  return (
    <div
      className={cn(
        "absolute right-1/4 top-1/2 -translate-y-1/2 pointer-events-none select-none z-50",
        className,
      )}
    >
      {/* Shield glow effect — pulse is decorative, skipped under reduced motion (#1103) */}
      <div
        className={cn(
          "absolute inset-0 bg-blue-500/30 rounded-full blur-xl",
          !reduceMotion && phase === "block" && "animate-pulse",
        )}
        style={{ transform: "scale(2)" }}
      />

      {/* Main block indicator */}
      <div
        className={cn(
          "flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500",
          "border-2 border-blue-400 rounded-lg px-4 py-2 shadow-lg shadow-blue-500/50",
          // #1103: drop the transition when motion is reduced.
          !reduceMotion && "transition-all duration-200 ease-out",
        )}
        style={getAnimationStyle()}
      >
        <span className="text-2xl">🛡️</span>
        <div className="flex flex-col">
          <span className="font-bold text-white text-sm">
            {action.sourceName}
          </span>
          <span className="text-blue-200 text-xs">blocking</span>
        </div>
      </div>

      {/* Shield particles — decorative, skipped under reduced motion (#1103) */}
      {!reduceMotion && phase === "block" && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-3 h-1 bg-blue-300 rounded-full"
              style={{
                transform: `rotate(${60 + i * 30}deg) translateX(15px)`,
                opacity: 0.8,
                animation: "ping 500ms ease-out",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Damage animation with floating combat text
export function DamageAnimation({
  action,
  onComplete,
  className,
}: CombatAnimationProps) {
  const [phase, setPhase] = useState<
    "idle" | "appear" | "float" | "fade" | "complete"
  >("idle");
  const [displayAmount, setDisplayAmount] = useState(0);
  // #1103: under reduced motion, skip the count-up + bounce/float/fade — show
  // the full damage value statically, dwell briefly so it's readable, complete.
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!action.amount) {
      return;
    }

    if (reduceMotion) {
      setDisplayAmount(action.amount);
      setPhase("appear");
      const completeTimer = setTimeout(() => {
        onComplete?.(action.id);
      }, 800);
      return () => clearTimeout(completeTimer);
    }

    // Animate the damage number counting up
    const steps = 10;
    const increment = action.amount / steps;
    let current = 0;

    const countInterval = setInterval(() => {
      current += increment;
      setDisplayAmount(Math.min(Math.round(current), action.amount || 0));
    }, 30);

    const appearTimer = setTimeout(() => setPhase("appear"), 50);
    const floatTimer = setTimeout(() => setPhase("float"), 300);
    const fadeTimer = setTimeout(() => setPhase("fade"), 1200);
    const completeTimer = setTimeout(() => {
      setPhase("complete");
      clearInterval(countInterval);
      onComplete?.(action.id);
    }, 1500);

    return () => {
      clearInterval(countInterval);
      clearTimeout(appearTimer);
      clearTimeout(floatTimer);
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [action.id, action.amount, onComplete, reduceMotion]);

  const getDamageColor = () => {
    switch (action.type) {
      case "lifelink":
        return "text-green-400";
      case "deathtouch":
        return "text-purple-400";
      case "trample":
        return "text-orange-400";
      default:
        return "text-red-400";
    }
  };

  if (phase === "idle" || phase === "complete") return null;

  return (
    <div
      className={cn(
        "absolute left-1/2 top-1/3 -translate-x-1/2 pointer-events-none select-none z-50",
        className,
      )}
    >
      {/* Damage number */}
      <div
        className={cn(
          "flex flex-col items-center",
          // #1103: motion classes only when motion is allowed.
          !reduceMotion && "transition-all duration-300",
          !reduceMotion && phase === "appear" && "animate-bounce",
          !reduceMotion && phase === "float" && "-translate-y-8",
          !reduceMotion && phase === "fade" && "opacity-0 -translate-y-16",
        )}
      >
        <span
          className={cn(
            "text-5xl font-bold drop-shadow-lg",
            getDamageColor(),
            // #1103: drop the pulse animation under reduced motion.
            !reduceMotion && "animate-pulse",
          )}
          style={{
            textShadow: "0 0 10px currentColor, 0 0 20px currentColor",
          }}
        >
          -{displayAmount}
        </span>

        {action.targetName && (
          <span className="text-sm text-muted-foreground mt-1">
            {action.targetName}
          </span>
        )}
      </div>

      {/* Impact effect — decorative, skipped under reduced motion (#1103) */}
      {!reduceMotion && phase === "appear" && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="w-16 h-16 bg-red-500/50 rounded-full animate-ping" />
        </div>
      )}
    </div>
  );
}

// Main combat animation component that routes to specific animation types
export function CombatAnimation({
  action,
  onComplete,
  className,
}: CombatAnimationProps) {
  switch (action.type) {
    case "attack":
    case "first-strike":
    case "double-strike":
      return (
        <AttackAnimation
          action={action}
          onComplete={onComplete}
          className={className}
        />
      );
    case "block":
      return (
        <BlockAnimation
          action={action}
          onComplete={onComplete}
          className={className}
        />
      );
    case "damage":
    case "lifelink":
    case "trample":
    case "deathtouch":
      return (
        <DamageAnimation
          action={action}
          onComplete={onComplete}
          className={className}
        />
      );
    default:
      return null;
  }
}

// Overlay for combat animations
export function CombatAnimations({
  actions,
  onActionComplete,
  className,
}: CombatAnimationsProps) {
  const handleComplete = useCallback(
    (id: string) => {
      onActionComplete?.(id);
    },
    [onActionComplete],
  );

  return (
    <div
      className={cn(
        "absolute inset-0 pointer-events-none overflow-hidden",
        className,
      )}
    >
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
  triggerAttack: (
    sourceId: string,
    sourceName: string,
    targetId?: string,
    targetName?: string,
    isFirstStrike?: boolean,
  ) => void;
  triggerBlock: (
    sourceId: string,
    sourceName: string,
    attackerId?: string,
  ) => void;
  triggerDamage: (
    sourceId: string,
    sourceName: string,
    amount: number,
    targetId?: string,
    targetName?: string,
    type?: CombatActionType,
  ) => void;
  triggerLifelink: (
    sourceId: string,
    sourceName: string,
    amount: number,
  ) => void;
  triggerTrample: (
    sourceId: string,
    sourceName: string,
    amount: number,
    targetId?: string,
    targetName?: string,
  ) => void;
  triggerDeathtouch: (
    sourceId: string,
    sourceName: string,
    targetId?: string,
    targetName?: string,
  ) => void;
  clearActions: () => void;
}

export function useCombatActions({
  maxActions = 5,
}: UseCombatActionsOptions = {}): UseCombatActionsReturn {
  const [actions, setActions] = useState<CombatAction[]>([]);

  const addAction = useCallback(
    (
      type: CombatActionType,
      sourceId: string,
      sourceName: string,
      options?: {
        targetId?: string;
        targetName?: string;
        amount?: number;
      },
    ) => {
      const newAction: CombatAction = {
        id: `combat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        sourceId,
        sourceName,
        ...options,
        timestamp: Date.now(),
      };
      setActions((prev) => [...prev, newAction].slice(-maxActions));
    },
    [maxActions],
  );

  const triggerAttack = useCallback(
    (
      sourceId: string,
      sourceName: string,
      targetId?: string,
      targetName?: string,
      isFirstStrike = false,
    ) => {
      addAction(
        isFirstStrike ? "first-strike" : "attack",
        sourceId,
        sourceName,
        { targetId, targetName },
      );
    },
    [addAction],
  );

  const triggerBlock = useCallback(
    (sourceId: string, sourceName: string, attackerId?: string) => {
      addAction("block", sourceId, sourceName, { targetId: attackerId });
    },
    [addAction],
  );

  const triggerDamage = useCallback(
    (
      sourceId: string,
      sourceName: string,
      amount: number,
      targetId?: string,
      targetName?: string,
      type: CombatActionType = "damage",
    ) => {
      addAction(type, sourceId, sourceName, { targetId, targetName, amount });
    },
    [addAction],
  );

  const triggerLifelink = useCallback(
    (sourceId: string, sourceName: string, amount: number) => {
      addAction("lifelink", sourceId, sourceName, { amount });
    },
    [addAction],
  );

  const triggerTrample = useCallback(
    (
      sourceId: string,
      sourceName: string,
      amount: number,
      targetId?: string,
      targetName?: string,
    ) => {
      addAction("trample", sourceId, sourceName, {
        targetId,
        targetName,
        amount,
      });
    },
    [addAction],
  );

  const triggerDeathtouch = useCallback(
    (
      sourceId: string,
      sourceName: string,
      targetId?: string,
      targetName?: string,
    ) => {
      addAction("deathtouch", sourceId, sourceName, { targetId, targetName });
    },
    [addAction],
  );

  const clearActions = useCallback(() => {
    setActions([]);
  }, []);

  return {
    actions,
    triggerAttack,
    triggerBlock,
    triggerDamage,
    triggerLifelink,
    triggerTrample,
    triggerDeathtouch,
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
  blockedBy?: string[];
  hasDealtDamage?: boolean;
  isTapped?: boolean;
  hasFirstStrike?: boolean;
  hasDoubleStrike?: boolean;
  hasDeathtouch?: boolean;
  hasTrample?: boolean;
  onTap?: () => void;
  className?: string;
}

export function CombatCard({
  cardId: _cardId,
  cardName,
  power = 0,
  toughness = 0,
  isAttacking = false,
  isBlocking = false,
  blockedBy = [],
  hasDealtDamage = false,
  isTapped = false,
  hasFirstStrike = false,
  hasDoubleStrike = false,
  hasDeathtouch = false,
  hasTrample = false,
  onTap,
  className,
}: CombatCardProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [showImpact, setShowImpact] = useState(false);
  // #1103: gate the bounce / pulse / scale micro-animations on the card.
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (isAttacking || isBlocking) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isAttacking, isBlocking]);

  useEffect(() => {
    if (hasDealtDamage) {
      setShowImpact(true);
      const timer = setTimeout(() => setShowImpact(false), 300);
      return () => clearTimeout(timer);
    }
  }, [hasDealtDamage]);

  const getBorderColor = () => {
    if (isAttacking && isBlocking)
      return "border-purple-500 shadow-purple-500/30";
    if (isAttacking) return "border-red-500 shadow-red-500/30";
    if (isBlocking) return "border-blue-500 shadow-blue-500/30";
    return "border-border";
  };

  return (
    <div
      className={cn(
        "relative w-16 h-24 bg-gradient-to-br from-primary/20 to-primary/5 border-2 rounded-lg",
        "flex flex-col items-center justify-between p-1 cursor-pointer",
        // #1103: keep the tap rotate (state, not motion) but drop the transition
        // and decorative bounce/pulse/scale when motion is reduced.
        !reduceMotion && "transition-all duration-200",
        isTapped && "rotate-90",
        getBorderColor(),
        (isAttacking || isBlocking) && "shadow-lg",
        hasDealtDamage && "opacity-60",
        !reduceMotion && isAnimating && "animate-bounce",
        !reduceMotion && showImpact && "animate-pulse scale-110",
        className,
      )}
      onClick={onTap}
    >
      {/* Card name */}
      <span className="text-[8px] font-medium truncate w-full text-center">
        {cardName}
      </span>

      {/* Power/Toughness */}
      <div className="flex items-center justify-center gap-1">
        <span
          className={cn(
            "text-xs font-bold",
            power > toughness ? "text-green-500" : "text-red-500",
          )}
        >
          {power}
        </span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs font-bold">{toughness}</span>
      </div>

      {/* Ability indicators */}
      <div className="absolute bottom-0.5 left-0.5 flex gap-0.5">
        {hasFirstStrike && (
          <span className="text-[8px]" title="First Strike">
            ⚡
          </span>
        )}
        {hasDoubleStrike && (
          <span className="text-[8px]" title="Double Strike">
            ⚡⚡
          </span>
        )}
        {hasDeathtouch && (
          <span className="text-[8px]" title="Deathtouch">
            💀
          </span>
        )}
        {hasTrample && (
          <span className="text-[8px]" title="Trample">
            🐘
          </span>
        )}
      </div>

      {/* Attack indicator — pulse is decorative, skipped under reduced motion (#1103) */}
      {isAttacking && (
        <div
          className={cn(
            "absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs shadow-lg",
            !reduceMotion && "animate-pulse",
          )}
        >
          ⚔️
        </div>
      )}

      {/* Block indicator */}
      {isBlocking && (
        <div className="absolute -top-2 -left-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs shadow-lg">
          🛡️
        </div>
      )}

      {/* Blocked by indicator */}
      {blockedBy.length > 0 && (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-[8px] px-1 rounded">
          Blocked by {blockedBy.length}
        </div>
      )}
    </div>
  );
}

// Combat phase indicator with animations
interface CombatPhaseIndicatorProps {
  phase:
    | "declare-attackers"
    | "declare-blockers"
    | "first-strike"
    | "combat-damage"
    | "end";
  className?: string;
}

export function CombatPhaseIndicator({
  phase,
  className,
}: CombatPhaseIndicatorProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  // #1103: phase banner is functional (announces the combat step), so it stays
  // visible; only the decorative bounce / flash are suppressed under reduced motion.
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    setIsAnimating(true);
    const animTimer = setTimeout(() => setIsAnimating(false), 500);
    const timer = setTimeout(() => setIsVisible(false), 2000);
    return () => {
      clearTimeout(animTimer);
      clearTimeout(timer);
    };
  }, [phase]);

  if (!isVisible) return null;

  const getPhaseText = () => {
    switch (phase) {
      case "declare-attackers":
        return {
          icon: "⚔️",
          text: "Declare Attackers",
          color: "from-red-600 to-red-500",
        };
      case "declare-blockers":
        return {
          icon: "🛡️",
          text: "Declare Blockers",
          color: "from-blue-600 to-blue-500",
        };
      case "first-strike":
        return {
          icon: "⚡",
          text: "First Strike Damage",
          color: "from-yellow-600 to-yellow-500",
        };
      case "combat-damage":
        return {
          icon: "💥",
          text: "Combat Damage",
          color: "from-orange-600 to-orange-500",
        };
      case "end":
        return {
          icon: "✅",
          text: "End of Combat",
          color: "from-green-600 to-green-500",
        };
      default:
        return { icon: "", text: "", color: "" };
    }
  };

  const { icon, text, color } = getPhaseText();

  return (
    <div
      className={cn(
        "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
        "pointer-events-none",
        className,
      )}
    >
      <div
        className={cn(
          "bg-gradient-to-r border-2 border-white/30 rounded-lg px-6 py-3 shadow-2xl",
          "flex items-center gap-3",
          color,
          // #1103: skip the decorative bounce under reduced motion.
          !reduceMotion && isAnimating && "animate-bounce",
        )}
        style={{
          animation:
            !reduceMotion && isAnimating ? "bounce 0.5s ease-out" : undefined,
        }}
      >
        <span className="text-3xl">{icon}</span>
        <span className="font-bold text-white text-lg">{text}</span>
      </div>

      {/* Background flash effect — decorative, skipped under reduced motion (#1103) */}
      {!reduceMotion && isAnimating && (
        <div className="absolute inset-0 -z-10 bg-white/20 rounded-lg animate-ping" />
      )}
    </div>
  );
}

// Combat declaration UI component
interface CombatDeclarationProps {
  attackers: Array<{ id: string; name: string; power: number }>;
  blockers: Array<{
    id: string;
    name: string;
    power: number;
    toughness: number;
  }>;
  onDeclareAttacker: (cardId: string) => void;
  onDeclareBlocker: (cardId: string, attackerId: string) => void;
  onConfirmAttackers?: () => void;
  onConfirmBlockers?: () => void;
  phase: "declare-attackers" | "declare-blockers";
  className?: string;
}

export function CombatDeclaration({
  attackers,
  blockers,
  onDeclareAttacker,
  onDeclareBlocker,
  onConfirmAttackers,
  onConfirmBlockers,
  phase,
  className,
}: CombatDeclarationProps) {
  const [selectedAttacker, setSelectedAttacker] = useState<string | null>(null);

  return (
    <div className={cn("p-4 bg-card border rounded-lg", className)}>
      <h3 className="font-semibold mb-3">
        {phase === "declare-attackers"
          ? "⚔️ Declare Attackers"
          : "🛡️ Declare Blockers"}
      </h3>

      {phase === "declare-attackers" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Click creatures to declare as attackers:
          </p>
          <div className="flex flex-wrap gap-2">
            {attackers.map((attacker) => (
              <button
                key={attacker.id}
                onClick={() => onDeclareAttacker(attacker.id)}
                className={cn(
                  "px-3 py-2 rounded border transition-all",
                  "hover:border-red-500 hover:bg-red-500/10",
                )}
              >
                <span className="font-medium">{attacker.name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {attacker.power}/{attacker.power}
                </span>
              </button>
            ))}
          </div>
          {onConfirmAttackers && (
            <button
              onClick={onConfirmAttackers}
              className="mt-3 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              Confirm Attackers
            </button>
          )}
        </div>
      )}

      {phase === "declare-blockers" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Select an attacker, then click a creature to block:
          </p>

          {/* Attackers to block */}
          <div className="flex flex-wrap gap-2 mb-3">
            {attackers.map((attacker) => (
              <button
                key={attacker.id}
                onClick={() => setSelectedAttacker(attacker.id)}
                className={cn(
                  "px-3 py-2 rounded border transition-all",
                  selectedAttacker === attacker.id
                    ? "border-red-500 bg-red-500/20"
                    : "hover:border-red-500/50",
                )}
              >
                <span className="font-medium">{attacker.name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {attacker.power}/?
                </span>
              </button>
            ))}
          </div>

          {/* Available blockers */}
          <div className="flex flex-wrap gap-2">
            {blockers.map((blocker) => (
              <button
                key={blocker.id}
                onClick={() =>
                  selectedAttacker &&
                  onDeclareBlocker(blocker.id, selectedAttacker)
                }
                disabled={!selectedAttacker}
                className={cn(
                  "px-3 py-2 rounded border transition-all",
                  selectedAttacker
                    ? "hover:border-blue-500 hover:bg-blue-500/10"
                    : "opacity-50 cursor-not-allowed",
                )}
              >
                <span className="font-medium">{blocker.name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {blocker.power}/{blocker.toughness}
                </span>
              </button>
            ))}
          </div>

          {onConfirmBlockers && (
            <button
              onClick={onConfirmBlockers}
              className="mt-3 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Confirm Blockers
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default CombatAnimations;
