"use client";

import * as React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Layers,
  Zap,
  Shield,
  User,
  ChevronDown,
  ChevronUp,
  AlertCircle,
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
 *
 * The `StackDisplay` renders as a modal overlay (Radix Dialog) so that focus
 * management, focus-trap, focus-restore and `Escape`-to-close all come from
 * the underlying `@radix-ui/react-dialog` primitive (see
 * `src/components/ui/dialog.tsx`). Keyboard users additionally get arrow-key
 * navigation across stack items (roving tabindex) and screen-reader users get
 * an `aria-live` region that announces stack push/resolve events.
 */
interface StackDisplayProps {
  /** Items currently on the stack */
  stack: StackItem[];
  /** Players in the game with priority information */
  players: PriorityInfo[];
  /** ID of the player who currently has priority */
  priorityPlayerId?: string;
  /** Whether the overlay is open (controlled). Defaults to true for backward compatibility. */
  isOpen?: boolean;
  /** Whether the stack is expanded to show details */
  expanded?: boolean;
  /** Callback when a stack item is clicked */
  onStackItemClick?: (itemId: string) => void;
  /** Callback when expand/collapse is toggled */
  onToggleExpand?: () => void;
  /** Callback when the overlay is dismissed (Escape / overlay click / Close button) */
  onClose?: () => void;
  /** CSS class name */
  className?: string;
}

/**
 * Priority Indicator Component
 */
const PriorityIndicator = memo(function PriorityIndicator({
  players,
}: {
  players: PriorityInfo[];
}) {
  const activePlayer = players.find((p) => p.hasPriority);

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
 * Single Stack Item Component.
 *
 * Rendered as a real `<button>` so it is keyboard-focusable and exposed to
 * assistive tech with an actionable role. Roving tabindex is controlled by the
 * parent list (only the active item has tabIndex 0, the rest -1) so Tab moves
 * into/out of the list and Arrow keys move within it — the standard WAI-ARIA
 * listbox/menu pattern.
 */
const StackItemDisplay = memo(function StackItemDisplay({
  item,
  position,
  isTop,
  isFocused,
  itemRef,
  onClick,
}: {
  item: StackItem;
  position: number;
  isTop: boolean;
  isFocused: boolean;
  itemRef: (el: HTMLButtonElement | null) => void;
  onClick?: () => void;
}) {
  const typeIcon =
    item.type === "spell" ? (
      <Zap className="h-4 w-4 text-yellow-500" />
    ) : (
      <Shield className="h-4 w-4 text-blue-500" />
    );

  const counterBadge = item.isCountered && (
    <Badge variant="destructive" className="text-xs">
      Countered
    </Badge>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            ref={itemRef}
            tabIndex={isFocused ? 0 : -1}
            onClick={onClick}
            aria-label={`Stack item ${position}: ${item.name}, ${item.type}, controlled by ${item.controllerName}${item.isCountered ? ", countered" : ""}${isTop ? ", top of stack" : ""}`}
            aria-current={isTop ? "true" : undefined}
            className={`
              w-full flex items-center gap-2 p-2 rounded-md border cursor-pointer
              transition-all hover:scale-[1.02] hover:shadow-md
              focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
              ${isTop ? "bg-primary/10 border-primary/30" : "bg-muted/30 border-border/50"}
              ${item.isCountered ? "opacity-50" : ""}
            `}
          >
            {/* Position indicator */}
            <div className="flex flex-col items-center text-xs text-muted-foreground w-6">
              <span className="font-mono">{position}</span>
              {isTop && <ChevronDown className="h-3 w-3 text-primary" />}
            </div>

            {/* Type icon */}
            {typeIcon}

            {/* Card name */}
            <div className="flex-1 min-w-0 text-left">
              <div className="font-medium text-sm truncate">{item.name}</div>
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
          </button>
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
 *
 * Renders the spell/ability stack as a focus-managed modal overlay. Focus trap,
 * initial-focus, focus-restore on close and `Escape`-to-close are provided by
 * the Radix Dialog primitive. Arrow-key navigation across items is implemented
 * via a roving tabindex, and an `aria-live` region announces push/resolve
 * events to screen-reader users.
 */
export const StackDisplay = memo(function StackDisplay({
  stack,
  players,
  priorityPlayerId: _priorityPlayerId,
  isOpen = true,
  expanded = false,
  onStackItemClick,
  onToggleExpand,
  onClose,
  className = "",
}: StackDisplayProps) {
  const isEmpty = stack.length === 0;

  // Items are presented newest-first (top of stack at the head of the list).
  const orderedItems = [...stack].reverse();

  // Roving tabindex state: only the item at `activeIndex` has tabIndex 0.
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Keep activeIndex in range when the stack changes.
  useEffect(() => {
    if (activeIndex >= orderedItems.length) {
      setActiveIndex(0);
    }
  }, [orderedItems.length, activeIndex]);

  // When the overlay opens or the active item changes, move DOM focus to it so
  // arrow-key navigation is observable to keyboard and SR users.
  useEffect(() => {
    if (!isOpen) return;
    const el = itemRefs.current[activeIndex];
    if (el) el.focus();
  }, [activeIndex, isOpen, orderedItems.length]);

  // aria-live announcement of stack push/resolve events.
  const liveRegionRef = useRef<HTMLDivElement | null>(null);
  const prevStackSigRef = useRef<{ len: number; topId?: string }>({
    len: stack.length,
    topId: stack[stack.length - 1]?.id,
  });
  useEffect(() => {
    const prev = prevStackSigRef.current;
    const cur = { len: stack.length, topId: stack[stack.length - 1]?.id };
    if (!liveRegionRef.current) return;
    let msg = "";
    if (cur.len > prev.len) {
      const top = stack[stack.length - 1];
      msg = top
        ? `New ${top.type} added to stack: ${top.name}`
        : "Stack updated";
    } else if (cur.len < prev.len) {
      msg =
        cur.len === 0
          ? "Stack is empty"
          : "Spell resolved and removed from stack";
    }
    if (msg) liveRegionRef.current.textContent = msg;
    prevStackSigRef.current = cur;
  }, [stack]);

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (orderedItems.length === 0) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % orderedItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 < 0 ? orderedItems.length - 1 : i - 1));
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(orderedItems.length - 1);
          break;
      }
    },
    [orderedItems.length],
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DialogContent
        className={`max-w-md gap-4 ${className}`}
        aria-modal="true"
        aria-describedby="stack-display-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4" />
            <span>Stack</span>
            <Badge variant="outline" className="text-xs">
              {stack.length} {stack.length === 1 ? "item" : "items"}
            </Badge>
          </DialogTitle>
          <DialogDescription id="stack-display-description">
            Spells and abilities on the stack, newest on top. Use arrow keys to
            move between items and Escape to close.
          </DialogDescription>
        </DialogHeader>

        {/* Priority indicator */}
        <div className="flex items-center justify-end">
          <PriorityIndicator players={players} />
        </div>

        {/* Live region for SR announcements of stack push/resolve events */}
        <div
          ref={liveRegionRef}
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        />

        <CardContent className="p-0">
          {isEmpty ? (
            <div
              className="flex flex-col items-center justify-center py-6 text-muted-foreground"
              role="status"
            >
              <Layers className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">Stack is empty</p>
              <p className="text-xs">Cast a spell or activate an ability</p>
            </div>
          ) : (
            <>
              {/* Stack items - newest on top. role="list" + arrow-key roving tabindex. */}
              <div
                className="space-y-1"
                role="list"
                aria-label="Spells and abilities on the stack"
                onKeyDown={handleListKeyDown}
              >
                {expanded
                  ? orderedItems.map((item, index) => (
                      <div role="listitem" key={item.id}>
                        <StackItemDisplay
                          item={item}
                          position={stack.length - index}
                          isTop={index === 0}
                          isFocused={index === activeIndex}
                          itemRef={(el) => {
                            itemRefs.current[index] = el;
                          }}
                          onClick={() => onStackItemClick?.(item.id)}
                        />
                      </div>
                    ))
                  : (stack[stack.length - 1] && (
                      <div role="listitem">
                        <StackItemDisplay
                          item={stack[stack.length - 1]}
                          position={stack.length}
                          isTop={true}
                          isFocused={true}
                          itemRef={(el) => {
                            itemRefs.current[0] = el;
                          }}
                          onClick={() =>
                            onStackItemClick?.(stack[stack.length - 1]!.id)
                          }
                        />
                      </div>
                    )) ||
                    null}
              </div>

              {/* Expand/collapse button */}
              {stack.length > 1 && (
                <button
                  type="button"
                  onClick={onToggleExpand}
                  className="w-full mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
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
      </DialogContent>
    </Dialog>
  );
});

/**
 * Compact Stack Display for embedding in other components
 *
 * Intentionally NOT an overlay — this is an inline summary used in the chrome
 * (e.g. a mobile layout status bar). Accessibility for the compact variant is
 * handled where it is mounted.
 */
export const CompactStackDisplay = memo(function CompactStackDisplay({
  stack,
  players,
  className = "",
}: {
  stack: StackItem[];
  players: PriorityInfo[];
  className?: string;
}) {
  if (stack.length === 0) {
    return null;
  }

  const topItem = stack[stack.length - 1];
  const activePlayer = players.find((p) => p.hasPriority);

  return (
    <div className={`flex items-center gap-2 ${className}`} role="status">
      <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
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
