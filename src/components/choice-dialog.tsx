"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Hash, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Props for X Value Selection Dialog
 */
export interface XValueChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: string;
  sourceCardName: string;
  minX: number;
  maxX: number;
  onSelect: (value: number) => void;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

/**
 * X Value Selection Dialog
 * Displays when a player must choose a value for X in a spell's cost/effect
 */
export function XValueChoiceDialog({
  open,
  onOpenChange,
  prompt,
  sourceCardName,
  minX,
  maxX,
  onSelect,
  onConfirm,
  onCancel,
}: XValueChoiceDialogProps) {
  const [selectedValue, setSelectedValue] = React.useState<number | null>(null);

  const canConfirm = selectedValue !== null && selectedValue >= minX && selectedValue <= maxX;

  const handleValueClick = (value: number) => {
    setSelectedValue(value);
    onSelect(value);
  };

  const handleConfirm = () => {
    if (selectedValue !== null && canConfirm) {
      onConfirm(selectedValue);
      setSelectedValue(null);
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    setSelectedValue(null);
    onCancel();
    onOpenChange(false);
  };

  React.useEffect(() => {
    if (open) {
      setSelectedValue(null);
    }
  }, [open]);

  const values = React.useMemo(() => {
    const result: number[] = [];
    for (let i = minX; i <= maxX; i++) {
      result.push(i);
    }
    return result;
  }, [minX, maxX]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5 text-primary" />
            {sourceCardName}
          </DialogTitle>
          <DialogDescription className="text-base">
            {prompt}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Select a value for X</span>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {values.map((value) => {
              const isSelected = selectedValue === value;
              return (
                <button
                  key={value}
                  onClick={() => handleValueClick(value)}
                  className={cn(
                    "h-12 rounded-lg text-lg font-bold transition-all",
                    isSelected
                      ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2"
                      : "bg-muted hover:bg-muted/80 text-foreground"
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>

          {selectedValue !== null && (
            <div className="bg-primary/10 rounded-lg p-3">
              <p className="text-sm font-medium text-primary">
                Selected: X = {selectedValue}
              </p>
            </div>
          )}

          <div className="text-xs text-muted-foreground text-center">
            Valid range: {minX} to {maxX}
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default XValueChoiceDialog;