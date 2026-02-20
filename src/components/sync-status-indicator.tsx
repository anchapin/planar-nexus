/**
 * Sync Status Indicator Component
 * Issue #313: UI for displaying state sync status and desync alerts
 */

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Wifi, 
  WifiOff, 
  AlertCircle,
  ChevronDown,
  ChevronUp,
  History,
  Users,
  Activity,
} from 'lucide-react';
import type { StateSyncStatus, DesyncAlert } from '@/hooks/use-state-sync';
import type { ConflictResolution } from '@/lib/game-state/deterministic-sync';

/**
 * Props for SyncStatusIndicator
 */
export interface SyncStatusIndicatorProps {
  /** Current sync status */
  status: StateSyncStatus;
  /** Current desync alert, if any */
  desyncAlert: DesyncAlert | null;
  /** Whether a resolution is in progress */
  isResolving: boolean;
  /** Last conflict resolution */
  lastResolution: ConflictResolution | null;
  /** Callback to trigger manual sync check */
  onCheckSync: () => void;
  /** Callback to attempt resolution */
  onResolveDesync: () => void;
  /** Whether to show detailed stats */
  showDetails?: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
}

/**
 * Component for displaying multiplayer sync status
 */
export function SyncStatusIndicator({
  status,
  desyncAlert,
  isResolving,
  lastResolution,
  onCheckSync,
  onResolveDesync,
  showDetails: _showDetails = false,
  compact = false,
}: SyncStatusIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showResolutionDialog, setShowResolutionDialog] = useState(false);

  // Determine sync state
  const getSyncState = () => {
    if (desyncAlert?.hasDesync) {
      return {
        icon: AlertTriangle,
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-500/10',
        label: 'Desync Detected',
        badge: 'warning',
      };
    }
    if (!status.isInSync) {
      return {
        icon: WifiOff,
        color: 'text-red-500',
        bgColor: 'bg-red-500/10',
        label: 'Out of Sync',
        badge: 'destructive',
      };
    }
    if (status.peerHashes.size === 0) {
      return {
        icon: Wifi,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/10',
        label: 'No Peers',
        badge: 'secondary',
      };
    }
    return {
      icon: CheckCircle2,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      label: 'In Sync',
      badge: 'success',
    };
  };

  const syncState = getSyncState();
  const Icon = syncState.icon;

  // Compact mode - just show status badge
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${syncState.bgColor}`}>
          <Icon className={`h-4 w-4 ${syncState.color}`} />
          <span className={`text-sm ${syncState.color}`}>{syncState.label}</span>
        </div>
        {desyncAlert && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResolutionDialog(true)}
            className="text-yellow-500 border-yellow-500"
          >
            <AlertTriangle className="h-4 w-4 mr-1" />
            Resolve
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <Card className="w-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Icon className={`h-5 w-5 ${syncState.color}`} />
              Sync Status
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={syncState.badge as 'default' | 'secondary' | 'destructive' | 'outline'}>
                {syncState.label}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Peers</p>
                <p className="font-medium">{status.peerHashes.size}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Match Rate</p>
                <p className="font-medium">{(status.statistics.matchRate * 100).toFixed(1)}%</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Checks</p>
                <p className="font-medium">{status.statistics.totalChecks}</p>
              </div>
            </div>
          </div>

          {/* Desync Alert */}
          {desyncAlert && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Desynchronization Detected</AlertTitle>
              <AlertDescription>
                <p className="text-sm mt-1">
                  Peer <code className="bg-muted px-1 rounded">{desyncAlert.peerId?.slice(0, 8)}...</code> has a different game state.
                </p>
                <div className="mt-2 text-xs font-mono">
                  <p>Local: {desyncAlert.localHash}</p>
                  <p>Remote: {desyncAlert.remoteHash}</p>
                </div>
                {desyncAlert.description && (
                  <p className="text-sm mt-1 text-muted-foreground">{desyncAlert.description}</p>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Expanded details */}
          {isExpanded && (
            <div className="space-y-4 pt-4 border-t">
              {/* Peer hashes */}
              <div>
                <h4 className="text-sm font-medium mb-2">Peer Hashes</h4>
                <div className="space-y-1">
                  {Array.from(status.peerHashes.entries()).map(([peerId, hash]) => (
                    <div key={peerId} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{peerId.slice(0, 12)}...</span>
                      <code className={`text-xs px-2 py-1 rounded ${
                        hash === status.localHash ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                      }`}>
                        {hash}
                      </code>
                    </div>
                  ))}
                  {status.peerHashes.size === 0 && (
                    <p className="text-sm text-muted-foreground">No peers connected</p>
                  )}
                </div>
              </div>

              {/* Statistics */}
              <div>
                <h4 className="text-sm font-medium mb-2">Statistics</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total Checks:</span>
                    <span className="ml-2">{status.statistics.totalChecks}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Mismatches:</span>
                    <span className="ml-2">{status.statistics.mismatchCount}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Consecutive Desyncs:</span>
                    <span className="ml-2">{status.consecutiveDesyncs}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Check:</span>
                    <span className="ml-2">
                      {status.lastSyncCheck > 0 
                        ? new Date(status.lastSyncCheck).toLocaleTimeString()
                        : 'Never'
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* Last Resolution */}
              {lastResolution && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Last Resolution</h4>
                  <div className="text-sm bg-muted p-2 rounded">
                    <p>
                      <span className="text-muted-foreground">Strategy:</span>{' '}
                      <Badge variant="outline">{lastResolution.strategy}</Badge>
                    </p>
                    <p className="mt-1">{lastResolution.conflictDescription}</p>
                    {lastResolution.rollbackSequence && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Rolled back to sequence {lastResolution.rollbackSequence}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={onCheckSync}
              disabled={isResolving}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isResolving ? 'animate-spin' : ''}`} />
              Check Sync
            </Button>
            {desyncAlert && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowResolutionDialog(true)}
                disabled={isResolving}
              >
                {isResolving ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Resolving...
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 mr-2" />
                    Resolve Desync
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resolution Dialog */}
      <Dialog open={showResolutionDialog} onOpenChange={setShowResolutionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Resolve Desynchronization
            </DialogTitle>
            <DialogDescription>
              A desynchronization has been detected between your game state and a peer's state.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <Alert>
              <AlertTitle>What happened?</AlertTitle>
              <AlertDescription>
                {desyncAlert?.description || 'Your game state differs from your opponent\'s state. This can happen due to network issues or timing differences.'}
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-muted p-3 rounded">
                <p className="font-medium mb-1">Your State</p>
                <code className="text-xs">{desyncAlert?.localHash}</code>
              </div>
              <div className="bg-muted p-3 rounded">
                <p className="font-medium mb-1">Peer State</p>
                <code className="text-xs">{desyncAlert?.remoteHash}</code>
              </div>
            </div>

            {lastResolution && (
              <div className="bg-muted p-3 rounded">
                <p className="font-medium mb-2">Suggested Resolution</p>
                <p className="text-sm">{lastResolution.conflictDescription}</p>
                <Badge variant="outline" className="mt-2">{lastResolution.strategy}</Badge>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolutionDialog(false)}>
              Cancel
            </Button>
            <Button onClick={onResolveDesync} disabled={isResolving}>
              {isResolving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Resolving...
                </>
              ) : (
                'Apply Resolution'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SyncStatusIndicator;