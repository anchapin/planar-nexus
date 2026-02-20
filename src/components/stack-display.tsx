"use client";

import * as React from "react";
import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Layers,
  Zap,
  Shield,
  User,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from "lucide-react";

/**
 * Stack item representing a spell or ability on the stack
 */
export interface StackItem {
  id: string;
  name: string;
  type: "spell" | "ability";
  controllerName: string;
  controllerId: string;
  oracleText?: string;
  manaCost?: string;
  isCountered?: boolean;
  timestamp: number;
}

/**
 * Player priority information
 */
export interface PriorityInfo {
  playerId: string;
  playerName: string;
  hasPriority: boolean;
}

/**
 * Stack Display Component Props
 */
interface StackDisplayProps {
  /** Items currently on the stack */
  stack: StackItem[];
  /** Players in the game with priority information */
  players: PriorityInfo[];
  /** ID of the player who currently has priority */
  priorityPlayerId?: string;
  /** Whether the stack is expanded to show details */
  expanded?: boolean;
  /** Callback when a stack item is clicked */
  onStackItemClick?: (itemId: string) => void;
  /** Callback when expand/collapse is toggled */
  onToggleExpand?: () => void;
  /** CSS class name */
  className?: string;
}

/**
 * Priority Indicator Component
 */
const PriorityIndicator = memo(function PriorityIndicator({
  players
}: {
  players: PriorityInfo[];
}) {
  const activePlayer = players.find(p => p.hasPriority);
  
  if (!activePlayer) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground text-sm">
        <AlertCircle className="h-3 w-3" />
        <span>No active priority</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 text-sm">
            <Shield className="h-3 w-3 text-green-500" />
            <span className="font-medium">{activePlayer.playerName}</span>
            <Badge variant="secondary" className="text-xs ml-1">
              Has Priority
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{activePlayer.playerName} has priority</p>
          <p className="text-xs text-muted-foreground mt-1">
            Players must pass priority to resolve the stack
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

/**
 * Single Stack Item Component
 */
const StackItemDisplay = memo(function StackItemDisplay({
  item,
  position,
  isTop,
  onClick
}: {
  item: StackItem;
  position: number;
  isTop: boolean;
  onClick?: () => void;
}) {
  const typeIcon = item.type === "spell" ? (
    <Zap className="h-4 w-4 text-yellow-500" />
  ) : (
    <Shield className="h-4 w-4 text-blue-500" />
  );

  const counterBadge = item.isCountered && (
    <Badge variant="destructive" className="text-xs">
      Countered
    </Badge  >
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={onClick}
            className={`
              flex items-center gap-2 p-2 rounded-md border cursor-pointer
              transition-all hover:scale-[1.02] hover:shadow-md
              ${isTop 
                ? "bg-primary/10 border-primary/30" 
                : "bg-muted/30 border-border/50"
              }
              ${item.isCountered ? "opacity-50" : ""}
            `}
          >
            {/* Position indicator */}
            <div className="flex flex-col items-center text-xs text-muted-foreground w-6">
              <span className="font-mono">{position}</span>
              {isTop && (
                <ChevronDown className="h-3 w-3 text-primary" />
              )}
            </div>

            {/* Type icon */}
            {typeIcon}

            {/* Card name */}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">
                {item.name}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <User className="h-2 w-2" />
                <span className="truncate">{item.controllerName}</span>
              </div>
            </div>

            {/* Mana cost */}
            {item.manaCost && (
              <Badge variant="outline" className="text-xs">
                {item.manaCost}
              </Badge>
            )}

            {/* Countered badge */}
            {counterBadge}
          </div>
        </TooltipTrigger>
        {item.oracleText && (
          <TooltipContent className="max-w-xs">
            <p className="font-medium">{item.name}</p>
            <p className="text-sm mt-1">{item.oracleText}</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
});

/**
 * Main Stack Display Component
 */
export const StackDisplay = memo(function StackDisplay({
  stack,
  players,
  priorityPlayerId: _priorityPlayerId,
  expanded = false,
  onStackItemClick,
  onToggleExpand,
  className = ""
}: StackDisplayProps) {
  const isEmpty = stack.length === 0;
  const topItem = stack[stack.length - 1];

  return (
    <Card className={`${className}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            <CardTitle className="text-sm">Stack</CardTitle>
            <Badge variant="outline" className="text-xs">
              {stack.length} {stack.length === 1 ? "item" : "items"}
            </Badge>
          </div>
          
          {/* Priority indicator */}
          <PriorityIndicator players={players} />
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">Stack is empty</p>
            <p className="text-xs">Cast a spell or activate an ability</p>
          </div>
        ) : (
          <>
            {/* Stack items - newest on top */}
            <div className="space-y-1">
              {expanded ? (
                // Show all items when expanded
                [...stack].reverse().map((item, index) => (
                  <StackItemDisplay
                    key={item.id}
                    item={item}
                    position={stack.length - index}
                    isTop={index === 0}
                    onClick={() => onStackItemClick?.(item.id)}
                  />
                ))
              ) : (
                // Show only top item when collapsed
                topItem && (
                  <StackItemDisplay
                    key={topItem.id}
                    item={topItem}
                    position={stack.length}
                    isTop={true}
                    onClick={() => onStackItemClick?.(topItem.id)}
                  />
                )
              )}
            </div>

            {/* Expand/collapse button */}
            {stack.length > 1 && (
              <button
                onClick={onToggleExpand}
                className="w-full mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    <span>Collapse</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    <span>Show {stack.length - 1} more</span>
                  </>
                )}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
});

/**
 * Compact Stack Display for embedding in other components
 */
export const CompactStackDisplay = memo(function CompactStackDisplay({
  stack,
  players,
  className = ""
}: {
  stack: StackItem[];
  players: PriorityInfo[];
  className?: string;
}) {
  if (stack.length === 0) {
    return null;
  }

  const topItem = stack[stack.length - 1];
  const activePlayer = players.find(p => p.hasPriority);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Layers className="h-4 w-4 text-muted-foreground" />
      <Badge variant="outline" className="text-xs">
        {stack.length}
      </Badge>
      
      {topItem && (
        <span className="text-sm font-medium truncate max-w-[150px]">
          {topItem.name}
        </span>
      )}
      
      {activePlayer && (
        <span className="text-xs text-muted-foreground">
          → {activePlayer.playerName}
        </span>
      )}
    </div>
  );
});

export default StackDisplay;
