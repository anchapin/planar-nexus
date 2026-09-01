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
}

export interface ModuleScore {
  file: string;
  score: number;
  detected: number;
  considered: number;
  survived: number;
  noCoverage: number;
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

export function computeModuleScores(data: unknown): ModuleScore[];

export function evaluateFloors(
  rows: Array<{ file: string; score: number }>,
  config: FloorConfig,
): FloorEvaluation;
