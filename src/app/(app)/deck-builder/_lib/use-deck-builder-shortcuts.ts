"use client";

import { useEffect } from "react";
import type { ScryfallCard } from "@/lib/card-database";
import {
  resolveDeckBuilderShortcut,
  type DeckBuilderShortcutContext,
} from "./deck-builder-shortcuts";

export interface UseDeckBuilderShortcutsHandlers {
  /** Add a card. When `max` is true, add up to the maximum allowed copies. */
  addCard: (card: ScryfallCard, max: boolean) => void;
  /** Remove a card. When `all` is true, remove every copy of it. */
  removeCard: (card: ScryfallCard, all: boolean) => void;
  /** Create a fresh, empty deck. */
  newDeck: () => void;
  /**
   * Draw another opening hand in the Hand Test simulator (optional; only the
   * deck-builder page wires this up). Issue #1439.
   */
  drawSample?: () => void;
  /**
   * Revert the most recent deck / sideboard edit (issue #1546). The hook
   * `useDeckHistory` owns the stack; this callback applies whatever entry
   * the page's reducer pops.
   */
  undo?: () => void;
  /** Re-apply the most recently undone edit (issue #1546). */
  redo?: () => void;
}

export interface UseDeckBuilderShortcutsOptions
  extends DeckBuilderShortcutContext, UseDeckBuilderShortcutsHandlers {}

/**
 * Installs a scoped (window-level) keydown listener that maps the documented
 * deck-builder shortcuts (+, -, Shift++/Shift+-, Enter, Ctrl/Cmd+N,
 * Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y, H) onto the provided handlers.
 * Shortcuts are suppressed while typing in form fields (so the browser's
 * native input undo keeps working in the deck-name textbox).
 *
 * Scoping: this hook is only mounted by the deck-builder page, so the listener
 * is automatically removed when navigating away from the page.
 */
export function useDeckBuilderShortcuts(
  options: UseDeckBuilderShortcutsOptions,
): void {
  const { selectedCard, addCard, removeCard, newDeck, drawSample, undo, redo } =
    options;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveDeckBuilderShortcut(event, { selectedCard });

      switch (action.type) {
        case "addCard":
          event.preventDefault();
          addCard(action.card, action.max);
          break;
        case "removeCard":
          event.preventDefault();
          removeCard(action.card, action.all);
          break;
        case "newDeck":
          event.preventDefault();
          newDeck();
          break;
        case "drawSample":
          event.preventDefault();
          drawSample?.();
          break;
        case "undo":
          // Only preventDefault when we actually have a handler. The
          // `resolveDeckBuilderShortcut` guard ensures the event didn't
          // originate from an editable target, so we never swallow a
          // browser-native input undo.
          if (undo) {
            event.preventDefault();
            undo();
          }
          break;
        case "redo":
          if (redo) {
            event.preventDefault();
            redo();
          }
          break;
        case "none":
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCard, addCard, removeCard, newDeck, drawSample, undo, redo]);
}
