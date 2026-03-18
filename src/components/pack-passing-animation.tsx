/**
 * Pack Passing Animation Component
 * 
 * Provides visual feedback for pack passing between user and AI.
 * NEIB-05: Pack passing animation shows cards moving between user and AI
 */

"use client";

import { cn } from "@/lib/utils";
import { Package, ArrowLeft, ArrowRight } from "lucide-react";

interface PackPassingAnimationProps {
  /** Is pack currently passing */
  isPassing: boolean;
  /** Direction of pack movement */
  direction: 'to-ai' | 'to-user';
  /** Children to render (the pack/cards) */
  children: React.ReactNode;
  /** Duration of animation in ms */
  duration?: number;
}

/**
 * Animation wrapper for pack passing
 * - Slides pack left when passing to AI
 * - Slides pack right when passing to user
 */
export function PackPassingAnimation({
  isPassing,
  direction,
  children,
  duration = 500,
}: PackPassingAnimationProps) {
  return (
    <div
      className={cn(
        "transition-all ease-in-out",
        isPassing && direction === 'to-ai' && "-translate-x-8 opacity-50 scale-95",
        isPassing && direction === 'to-user' && "translate-x-8 opacity-50 scale-95"
      )}
      style={{
        transitionDuration: isPassing ? `${duration}ms` : '0ms',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Direction arrow indicator
 */
export function PackDirectionIndicator({ 
  direction,
  isVisible 
}: { 
  direction: 'to-ai' | 'to-user';
  isVisible: boolean;
}) {
  if (!isVisible) return null;
  
  return (
    <div className={cn(
      "flex items-center justify-center w-8 h-8 rounded-full",
      direction === 'to-ai' 
        ? "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300" 
        : "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300"
    )}>
      {direction === 'to-ai' ? (
        <ArrowRight className="h-4 w-4" />
      ) : (
        <ArrowLeft className="h-4 w-4" />
      )}
    </div>
  );
}

/**
 * Pack holder indicator badge
 */
export function PackHolderBadge({ 
  holder,
  isAiEnabled 
}: { 
  holder: 'user' | 'ai';
  isAiEnabled: boolean;
}) {
  if (!isAiEnabled) return null;
  
  return (
    <span className={cn(
      "absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium shadow-sm",
      holder === 'user' 
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" 
        : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100"
    )}>
      {holder === 'user' ? "Your pack" : "AI's pack"}
    </span>
  );
}

/**
 * Turn indicator - shows whose turn it is to pick
 */
export function TurnIndicator({ 
  isUserTurn,
  isAiEnabled 
}: { 
  isUserTurn: boolean;
  isAiEnabled: boolean;
}) {
  if (!isAiEnabled) return null;
  
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium",
      isUserTurn 
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200" 
        : "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200"
    )}>
      <Package className="h-4 w-4" />
      <span>
        {isUserTurn ? "Your turn to pick" : "AI is thinking..."}
      </span>
    </div>
  );
}
