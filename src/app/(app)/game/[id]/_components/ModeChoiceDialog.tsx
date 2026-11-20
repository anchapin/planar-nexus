"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Issue #2418 (SLICE 9) — the "choose mode" dialog of the single-player
 * board.
 *
 * This is the modal `GameBoardContent` shows for the two kinds of mode
 * choices it can trigger:
 *
 *  - the modal spell of a "choose one / choose two" spell (e.g. Abrade):
 *    a single pick that is confirmed immediately, and
 *  - a modal ability on the stack (CR 603.3c, 700.2a, #2525): a pick of
 *    `choose` modes, where every click toggles a mode until the required
 *    number of modes is reached.
 *
 * Both share the exact same rendering (title, description layout, one button
 * per mode) and differ only in their selection semantics, so they are
 * rendered by this single leaf component.
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow props, so a change
 * to (say) the battlefield no longer re-renders it. The whole `GameState`
 * object is deliberately NOT passed down — only the handful of values below
 * plus the stable callbacks of the parent.
 */

/**
 * How many modes the player may pick, and how the pick is confirmed:
 *
 *  - `"single"`: exactly one mode is picked and the choice is committed
 *    right away (modal spells),
 *  - `"multi"`: up to `choose` modes are picked; every click toggles a mode
 *    and the choice is committed once `choose` modes are picked (modal
 *    abilities).
 */
export type ModeChoiceSelectionMode = "single" | "multi";

/** Stable empty default, so the memoized props keep their identity. */
const NO_MODES: string[] = [];
const NO_PICKED: string[] = [];

export interface ModeChoiceDialogProps {
  /** Whether the dialog is open (i.e. a choice is pending). */
  isOpen: boolean;
  /**
   * Closes the dialog (the parent clears the pending choice). Only called
   * when the dialog is dismissable — see `dismissable`.
   */
  onClose?: () => void;
  /** Name of the card the modes belong to. */
  cardName: string;
  /** The modes to offer, one button each. */
  modes?: string[];
  /** Whether a single mode or `choose` modes are picked. */
  selectionMode: ModeChoiceSelectionMode;
  /**
   * How many modes have to be picked in `"multi"` mode (e.g. 2 for a "choose
   * two" ability). Ignored in `"single"` mode.
   */
  choose?: number;
  /**
   * The modes that are already picked in `"multi"` mode — they are rendered
   * as selected buttons. Ignored in `"single"` mode.
   */
  picked?: string[];
  /**
   * Called with the picked mode in `"multi"` mode. The parent toggles the
   * mode and commits the choice once enough modes are picked.
   */
  onSelect?: (mode: string) => void;
  /**
   * Called with the index of the picked mode in `"single"` mode. The parent
   * casts the spell with that mode.
   */
  onSelectIndex?: (index: number) => void;
  /**
   * Whether the dialog can be dismissed (backdrop click, escape key, close
   * button). `false` keeps the dialog open until a mode is picked — the
   * modal ability of #2525 must always be answered.
   */
  dismissable?: boolean;
}

export const ModeChoiceDialog = memo(function ModeChoiceDialog({
  isOpen,
  onClose,
  cardName,
  modes = NO_MODES,
  selectionMode,
  choose,
  picked = NO_PICKED,
  onSelect,
  onSelectIndex,
  dismissable = true,
}: ModeChoiceDialogProps) {
  const description =
    selectionMode === "single"
      ? `${cardName} has multiple modes. Choose one.`
      : `${cardName}: choose ${choose === 1 ? "one" : (choose ?? "")}.`;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && dismissable) onClose?.();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose Mode</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          {modes.map((mode, idx) => (
            <Button
              key={idx}
              variant={
                selectionMode === "multi" && picked.includes(mode)
                  ? "default"
                  : "outline"
              }
              onClick={() => {
                if (selectionMode === "single") onSelectIndex?.(idx);
                else onSelect?.(mode);
              }}
              className="justify-start h-auto py-3 px-4 text-left"
            >
              <div className="text-left">
                <div className="font-medium">Mode {idx + 1}</div>
                <div className="text-xs text-muted-foreground line-clamp-3 mt-1">
                  {mode}
                </div>
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
});
