/**
 * P2PDegradeDialog
 *
 * Non-blocking, accessible recovery prompt shown when the P2P connection fails
 * terminally (issue #1090). Replaces the previous dead-end "connection lost"
 * state with three recovery paths:
 *
 *   1. Continue in local hot-seat mode using the in-progress game state.
 *   2. Save the game to IndexedDB to resume later.
 *   3. Abandon the match.
 *
 * Built on the radix AlertDialog primitive (role="alertdialog") — it does NOT
 * use native alert/confirm, which were removed in #1100/#1150. The dialog is
 * fully controlled by the caller via the `open` flag and the action callbacks
 * so it stays presentational and trivially testable.
 */

"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface P2PDegradeDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Human-readable reason for the failure (from ConnectionFailureDiagnostic). */
  reason?: string;
  /** Actionable remediation hint (from ConnectionFailureDiagnostic). */
  remediation?: string;
  /** True while a save/continue operation is in flight (disables actions). */
  isSaving?: boolean;
  /** Continue the in-progress game in local hot-seat mode. */
  onContinueLocally: () => void;
  /** Persist the in-progress game to IndexedDB for later resume. */
  onSaveForResume: () => void;
  /** Abandon the match and dismiss the prompt. */
  onAbandon: () => void;
  className?: string;
}

export function P2PDegradeDialog({
  open,
  reason,
  remediation,
  isSaving = false,
  onContinueLocally,
  onSaveForResume,
  onAbandon,
  className,
}: P2PDegradeDialogProps) {
  const defaultReason =
    "The peer-to-peer connection failed and could not be recovered after all fallbacks and reconnection attempts.";

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className={cn(className)}
        data-testid="p2p-degrade-dialog"
      >
        <AlertDialogHeader>
          <AlertDialogTitle data-testid="p2p-degrade-title">
            Connection lost — continue locally?
          </AlertDialogTitle>
          <AlertDialogDescription data-testid="p2p-degrade-description">
            {reason || defaultReason}
            {remediation ? ` ${remediation}` : ""} Your in-progress game can be
            preserved on this device.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction
            onClick={onContinueLocally}
            disabled={isSaving}
            data-testid="p2p-degrade-continue"
          >
            Continue in local hot-seat
          </AlertDialogAction>
          <AlertDialogAction
            onClick={onSaveForResume}
            disabled={isSaving}
            data-testid="p2p-degrade-save"
          >
            {isSaving ? "Saving…" : "Save game to resume later"}
          </AlertDialogAction>
          <AlertDialogCancel
            onClick={onAbandon}
            disabled={isSaving}
            data-testid="p2p-degrade-abandon"
          >
            Abandon match
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default P2PDegradeDialog;
