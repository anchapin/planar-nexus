/**
 * @fileoverview Re-export shim for the canonical ValidationService.
 *
 * Issue #2967 — this module used to hold a second, diverged copy of the
 * action-validation rules. It is now a leaf re-export of the single
 * implementation that lives in the rules engine
 * (`@/lib/game-state/validation-service`), mirroring the
 * `@/lib/game-state/lite-validation` entry point.
 *
 * The `@/lib/validation-service` import path keeps working for existing
 * callers (e.g. the game board UI); there is exactly one `ValidationService`
 * implementation in the codebase now.
 */
export { ValidationService } from "./game-state/validation-service";
export type {
  ValidationResult,
  CastAlternativeCost,
} from "./game-state/validation-service";
