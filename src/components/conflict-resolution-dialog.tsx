/**
 * Conflict Resolution Dialog Component
 * Issue #314: UI for handling multiplayer desync conflicts
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertTriangle,
  RefreshCw,
  History,
  Users,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  Info,
} from 'lucide-react';
import type { ConflictResolution, HashDiscrepancy } from '@/lib/game-state/deterministic-sync';

/**
 * Resolution strategy options
 */
export type ResolutionStrategy = 'rollback' | 'forward' | 'merge' | 'authoritative' | 'manual';

/**
 * Props for ConflictResolutionDialog
 */
export interface ConflictResolutionDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog closes */
  onOpenChange: (open: boolean) => void;
  /** The detected discrepancies */
  discrepancies: HashDiscrepancy[];
  /** The suggested resolution from the engine */
  suggestedResolution: ConflictResolution | null;
  /** Local player's name */
  localPlayerName: string;
  /** Remote player's name */
  remotePlayerName: string;
  /** Whether resolution is in progress */
  isResolving: boolean;
  /** Callback when user confirms resolution */
  onResolve: (strategy: ResolutionStrategy) => void;
  /** Callback to request full state from peer */
  onRequestState: () => void;
  /** Whether this is the host (has authoritative power) */
  isHost: boolean;
}

/**
 * Component for resolving multiplayer desync conflicts
 */
export function ConflictResolutionDialog({
  open,
  onOpenChange,
  discrepancies,
  suggestedResolution,
  localPlayerName,
  remotePlayerName,
  isResolving,
  onResolve,
  onRequestState,
  isHost,
}: ConflictResolutionDialogProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<ResolutionStrategy>('rollback');
  const [showDetails, setShowDetails] = useState(false);

  // Set default strategy based on suggestion
  useEffect(() => {
    if (suggestedResolution) {
      setSelectedStrategy(suggestedResolution.strategy as ResolutionStrategy);
    }
  }, [suggestedResolution]);

  // Get strategy description
  const getStrategyDescription = (strategy: ResolutionStrategy): string => {
    switch (strategy) {
      case 'rollback':
        return 'Revert to the last known synchronized state and replay actions. Safest option but may lose recent actions.';
      case 'forward':
        return 'Continue with the current state and accept the differences. Use when differences are minor.';
      case 'merge':
        return 'Attempt to merge the differences intelligently. Best for simple conflicts like life total discrepancies.';
      case 'authoritative':
        return isHost
          ? 'Use your state as the authoritative source. The other player will sync to your state.'
          : 'Accept the host\'s state as authoritative. Your state will be overwritten.';
      case 'manual':
        return 'Manually review and decide which values to keep. Requires both players to agree.';
      default:
        return '';
    }
  };

  // Get severity color
  const getSeverityColor = (category: string): string => {
    switch (category) {
      case 'player':
        return 'text-yellow-500';
      case 'zone':
        return 'text-orange-500';
      case 'stack':
        return 'text-red-500';
      case 'combat':
        return 'text-purple-500';
      case 'turn':
        return 'text-blue-500';
      default:
        return 'text-gray-500';
    }
  };

  // Handle resolution
  const handleResolve = () => {
    onResolve(selectedStrategy);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Game State Conflict Detected
          </DialogTitle>
          <DialogDescription>
            Your game state differs from {remotePlayerName}'s state. Please choose how to resolve this conflict.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning Alert */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Desynchronization Warning</AlertTitle>
            <AlertDescription>
              This can happen due to network latency, packet loss, or timing differences.
              Please review the discrepancies below and choose a resolution strategy.
            </AlertDescription>
          </Alert>

          {/* Discrepancies List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Info className="h-4 w-4" />
                Detected Differences ({discrepancies.length})
              </h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? 'Hide' : 'Show'} Details
              </Button>
            </div>

            {showDetails && (
              <ScrollArea className="h-40 rounded border p-2">
                <div className="space-y-2">
                  {discrepancies.map((d, i) => (
                    <div key={i} className="text-sm p-2 bg-muted rounded">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={getSeverityColor(d.category)}>
                          {d.category}
                        </Badge>
                        <span className="font-medium">{d.description}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">You: </span>
                          <code className="bg-background px-1 rounded">{d.localValue}</code>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{remotePlayerName}: </span>
                          <code className="bg-background px-1 rounded">{d.remoteValue}</code>
                        </div>
                      </div>
                    </div>
                  ))}
                  {discrepancies.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No specific discrepancies detected. States may differ in ways that require full comparison.
                    </p>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>

          <Separator />

          {/* Resolution Strategies */}
          <div>
            <h4 className="text-sm font-medium mb-3">Resolution Strategy</h4>
            <RadioGroup
              value={selectedStrategy}
              onValueChange={(v) => setSelectedStrategy(v as ResolutionStrategy)}
              className="space-y-3"
            >
              <div className="flex items-start space-x-3 p-3 rounded border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="rollback" id="rollback" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="rollback" className="flex items-center gap-2 cursor-pointer">
                    <History className="h-4 w-4" />
                    Rollback to Last Sync
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getStrategyDescription('rollback')}
                  </p>
                </div>
                {suggestedResolution?.strategy === 'rollback' && (
                  <Badge variant="secondary">Suggested</Badge>
                )}
              </div>

              <div className="flex items-start space-x-3 p-3 rounded border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="authoritative" id="authoritative" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="authoritative" className="flex items-center gap-2 cursor-pointer">
                    <Users className="h-4 w-4" />
                    {isHost ? 'Use Your State (Host)' : 'Accept Host State'}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getStrategyDescription('authoritative')}
                  </p>
                </div>
                {suggestedResolution?.strategy === 'authoritative' && (
                  <Badge variant="secondary">Suggested</Badge>
                )}
              </div>

              <div className="flex items-start space-x-3 p-3 rounded border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="forward" id="forward" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="forward" className="flex items-center gap-2 cursor-pointer">
                    <ArrowRight className="h-4 w-4" />
                    Continue Forward
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getStrategyDescription('forward')}
                  </p>
                </div>
                {suggestedResolution?.strategy === 'forward' && (
                  <Badge variant="secondary">Suggested</Badge>
                )}
              </div>

              <div className="flex items-start space-x-3 p-3 rounded border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="merge" id="merge" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="merge" className="flex items-center gap-2 cursor-pointer">
                    <RefreshCw className="h-4 w-4" />
                    Merge States
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getStrategyDescription('merge')}
                  </p>
                </div>
                {suggestedResolution?.strategy === 'merge' && (
                  <Badge variant="secondary">Suggested</Badge>
                )}
              </div>

              <div className="flex items-start space-x-3 p-3 rounded border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="manual" id="manual" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="manual" className="flex items-center gap-2 cursor-pointer">
                    <Clock className="h-4 w-4" />
                    Manual Resolution
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getStrategyDescription('manual')}
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Suggested Resolution Info */}
          {suggestedResolution && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Automatic Suggestion</AlertTitle>
              <AlertDescription>
                {suggestedResolution.conflictDescription}
                {suggestedResolution.rollbackSequence && (
                  <p className="text-xs mt-1">
                    Would rollback to sequence #{suggestedResolution.rollbackSequence}
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onRequestState}
              disabled={isResolving}
            >
              Request Full State
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isResolving}
            >
              Cancel
            </Button>
          </div>
          <Button
            onClick={handleResolve}
            disabled={isResolving}
            className="w-full sm:w-auto"
          >
            {isResolving ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Resolving...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Apply Resolution
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConflictResolutionDialog;