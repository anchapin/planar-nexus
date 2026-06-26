"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmDialogOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * Promise-returning confirm dialog built on the accessible AlertDialog
 * primitive. Replaces native blocking `window.confirm()` (issue #1100).
 *
 * @example
 * const { confirm, confirmDialog } = useConfirmDialog();
 * async function handleDelete() {
 *   if (await confirm({ title: "Delete?", destructive: true })) {
 *     doDelete();
 *   }
 * }
 * // render the dialog once inside the component's JSX:
 * return <div>{confirmDialog}</div>;
 */
export function useConfirmDialog() {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmDialogOptions | null>(
    null,
  );
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  const confirm = React.useCallback(
    (opts: ConfirmDialogOptions): Promise<boolean> => {
      setOptions(opts);
      setOpen(true);
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [],
  );

  const settle = React.useCallback((value: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    if (resolver) resolver(value);
  }, []);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) settle(false);
    },
    [settle],
  );

  const confirmDialog = (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
          {options?.description ? (
            <AlertDialogDescription>
              {options.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {options?.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              options?.destructive &&
                buttonVariants({ variant: "destructive" }),
            )}
            onClick={() => settle(true)}
          >
            {options?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}
