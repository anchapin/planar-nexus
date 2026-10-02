"use client";

import { createContext, useContext } from "react";

/**
 * Ids of cards (and players) that are legal targets for whatever is choosing
 * targets right now (#2300). Empty when nothing is targeting. Cards read it
 * through `useIsLegalTarget` so the board doesn't thread a prop through every
 * memoized zone component.
 */
const EMPTY: ReadonlySet<string> = new Set();

export const TargetHighlightContext = createContext<ReadonlySet<string>>(EMPTY);

export function useIsLegalTarget(id: string): boolean {
  return useContext(TargetHighlightContext).has(id);
}
