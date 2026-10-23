/**
 * Type declarations for scripts/mutation-floor-lib.js (issue #1598).
 *
 * The implementation is plain CommonJS (no runtime deps); this file gives it
 * precise types for TypeScript consumers (the Jest suite in
 * tests/mutation-floor.test.ts). Signatures mirror the runtime exports.
 */

export interface FloorConfig {
  defaultFloor: number;
  floors: Record<string, number>;
  /** Per-module ceiling on static (uncovered-code) mutants, keyed by the
   * same module globs as `floors`. */
  uncoveredBudgets?: Record<string, number>;
  /** Ceiling applied to files that no `uncoveredBudgets` glob claims. */
  defaultUncoveredBudget?: number;
}

export interface ModuleScore {
  file: string;
  score: number;
  detected: number;
  considered: number;
  survived: number;
  noCoverage: number;
  /** Static mutants Stryker skipped because no test covers them. */
  ignored: number;
}

export interface Violation {
  file: string;
  score: number;
  floor: number;
}

export interface FloorEvaluation {
  violations: Violation[];
  ok: boolean;
}

export const DEFAULT_FLOOR: number;
export const REPORT_PATH: string;
export const COUNTED_STATUSES: string[];

export function loadFloorConfig(
  env?: Record<string, string | undefined>,
): FloorConfig;

export function floorFor(normalizedPath: string, config: FloorConfig): number;

/** Issue #1725: glob floor keys mirror Stryker allowlist dir globs. */
export function globToRegExp(glob: string): RegExp;

export function computeModuleScores(data: unknown): ModuleScore[];

export function evaluateFloors(
  rows: Array<{ file: string; score: number }>,
  config: FloorConfig,
): FloorEvaluation;

/** Resolve the module glob key that owns a normalised file path. */
export function moduleFor(
  normalizedPath: string,
  config: FloorConfig,
): string | null;

/** Aggregate ignored (static / uncovered) mutant counts per module. */
export function computeUncoveredByModule(
  rows: Array<{ file: string; ignored: number }>,
  config: FloorConfig,
): Record<string, number>;

export interface UncoveredViolation {
  module: string;
  uncovered: number;
  budget: number;
}

export interface UncoveredEvaluation {
  violations: UncoveredViolation[];
  ok: boolean;
}

/** Evaluate per-module uncovered-mutant counts against their budgets. */
export function evaluateUncoveredBudgets(
  rows: Array<{ file: string; ignored: number }>,
  config: FloorConfig,
): UncoveredEvaluation;
