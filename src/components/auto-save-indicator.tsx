/**
 * @fileOverview Auto-save status indicator component
 * 
 * Issue #269: Auto-save functionality for game states
 * 
 * Provides:
 * - Visual indicator for auto-save status
 * - Animated saving state
 * - Success/error feedback
 * - Configurable display
 */

"use client";

import { Save, Check, AlertTriangle, Loader2, Cloud, CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutoSaveStatus } from "@/hooks/use-auto-save";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface AutoSaveIndicatorProps {
  /** Current auto-save status */
  status: AutoSaveStatus;
  /** Whether auto-save is enabled */
  isEnabled?: boolean;
  /** Last save timestamp */
  lastSaveTime?: number | null;
  /** Show detailed tooltip */
  showTooltip?: boolean;
  /** Custom className */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

/**
 * Format time since last save
 */
function formatTimeSince(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 1000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

/**
 * Auto-save status indicator
 */
export function AutoSaveIndicator({
  status,
  isEnabled = true,
  lastSaveTime,
  showTooltip = true,
  className,
  onClick,
}: AutoSaveIndicatorProps) {
  const getStatusContent = () => {
    if (!isEnabled) {
      return {
        icon: CloudOff,
        label: 'Auto-save disabled',
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
      };
    }

    switch (status) {
      case 'saving':
        return {
          icon: Loader2,
          label: 'Saving...',
          color: 'text-blue-500',
          bgColor: 'bg-blue-500/10',
          animate: true,
        };
      case 'success':
        return {
          icon: Check,
          label: lastSaveTime ? `Saved ${formatTimeSince(lastSaveTime)}` : 'Saved',
          color: 'text-green-500',
          bgColor: 'bg-green-500/10',
        };
      case 'error':
        return {
          icon: AlertTriangle,
          label: 'Save failed',
          color: 'text-red-500',
          bgColor: 'bg-red-500/10',
        };
      default:
        return {
          icon: Cloud,
          label: lastSaveTime ? `Last saved ${formatTimeSince(lastSaveTime)}` : 'Ready',
          color: 'text-muted-foreground',
          bgColor: 'bg-muted',
        };
    }
  };

  const content = getStatusContent();
  const Icon = content.icon;

  const indicator = (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
        content.bgColor,
        content.color,
        className
      )}
      onClick={onClick}
    >
      <Icon className={cn('h-4 w-4', content.animate && 'animate-spin')} />
      <span>{content.label}</span>
    </div>
  );

  if (!showTooltip) {
    return indicator;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {indicator}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">Auto-Save Status</p>
            <p className="text-xs text-muted-foreground">
              {!isEnabled
                ? 'Auto-save is currently disabled in settings'
                : status === 'saving'
                ? 'Saving your game progress...'
                : status === 'success'
                ? 'Game saved successfully'
                : status === 'error'
                ? 'Failed to save. Your progress may not be preserved.'
                : 'Game will auto-save at key moments'}
            </p>
            {lastSaveTime && (
              <p className="text-xs text-muted-foreground">
                Last save: {new Date(lastSaveTime).toLocaleTimeString()}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Compact version of auto-save indicator (icon only)
 */
export function AutoSaveIcon({
  status,
  isEnabled = true,
  className,
}: {
  status: AutoSaveStatus;
  isEnabled?: boolean;
  className?: string;
}) {
  if (!isEnabled) {
    return (
      <CloudOff className={cn('h-4 w-4 text-muted-foreground', className)} />
    );
  }

  switch (status) {
    case 'saving':
      return <Loader2 className={cn('h-4 w-4 text-blue-500 animate-spin', className)} />;
    case 'success':
      return <Check className={cn('h-4 w-4 text-green-500', className)} />;
    case 'error':
      return <AlertTriangle className={cn('h-4 w-4 text-red-500', className)} />;
    default:
      return <Cloud className={cn('h-4 w-4 text-muted-foreground', className)} />;
  }
}

/**
 * Auto-save status badge for game lists
 */
export function AutoSaveBadge({
  isAutoSave,
  slot,
  className,
}: {
  isAutoSave: boolean;
  slot?: number;
  className?: string;
}) {
  if (!isAutoSave) return null;

  return (
    <Badge variant="outline" className={cn('bg-blue-500/10 text-blue-500', className)}>
      <Save className="h-3 w-3 mr-1" />
      Auto-Save {slot !== undefined ? slot + 1 : ''}
    </Badge>
  );
}
