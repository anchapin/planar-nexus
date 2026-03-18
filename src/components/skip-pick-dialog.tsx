'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Props for SkipPickDialog component
 */
export interface SkipPickDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Auto-skip countdown in seconds (default: 5) */
  autoSkipCountdown?: number;
  /** Callback when skip is confirmed */
  onSkip: () => void;
  /** Callback when user cancels (goes back to picking) */
  onCancel: () => void;
}

/**
 * Skip Pick Dialog Component
 * 
 * DRFT-08: Shows when timer expires without a hovered card
 * 
 * Features:
 * - Modal overlay with "Time's Up!" message
 * - Auto-skip countdown timer
 * - Skip and Cancel buttons
 */
export function SkipPickDialog({
  isOpen,
  autoSkipCountdown = 5,
  onSkip,
  onCancel,
}: SkipPickDialogProps) {
  const [countdown, setCountdown] = useState(autoSkipCountdown);

  // Reset countdown when dialog opens
  useEffect(() => {
    if (isOpen) {
      setCountdown(autoSkipCountdown);
    }
  }, [isOpen, autoSkipCountdown]);

  // Auto-skip countdown effect
  useEffect(() => {
    if (!isOpen || countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Auto-skip when countdown reaches 0
          onSkip();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, countdown, onSkip]);

  const handleSkip = useCallback(() => {
    onSkip();
  }, [onSkip]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Clock className="w-6 h-6 text-yellow-500 animate-pulse" />
            Time&apos;s Up!
          </DialogTitle>
          <DialogDescription className="text-base">
            No card was hovered, so we can&apos;t auto-pick for you.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex flex-col items-center justify-center gap-4">
            {/* Auto-skip countdown */}
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">
                Auto-skipping in
              </p>
              <div
                className={cn(
                  'text-5xl font-bold tabular-nums',
                  countdown <= 3 ? 'text-red-500 animate-pulse' : 'text-foreground'
                )}
              >
                {countdown}
              </div>
            </div>

            {/* Visual progress indicator */}
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all duration-1000 ease-linear',
                  countdown <= 3 ? 'bg-red-500' : 'bg-yellow-500'
                )}
                style={{ width: `${(countdown / autoSkipCountdown) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="w-full sm:w-auto"
          >
            Go Back to Picking
          </Button>
          <Button
            variant="destructive"
            onClick={handleSkip}
            className="w-full sm:w-auto"
          >
            Skip This Pick
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
