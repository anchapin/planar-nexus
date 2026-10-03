/**
 * @fileoverview Leaf entry point for ValidationService (issue #2470).
 *
 * Kept separate from "@/lib/game-state/lite" on purpose: without
 * tree-shaking across re-exports, any route importing lite.ts would pull
 * ValidationService's priority and keyword dependencies, which live in the
 * shared engine chunk. Only the multiplayer connection code needs this one.
 * Same rule as lite.ts: leaf modules only, never the rules engine.
 */
export { ValidationService } from "./validation-service";
