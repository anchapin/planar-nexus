/**
 * Type declarations for scripts/ratchet-coverage.js (issue #1099).
 *
 * The implementation is plain CommonJS (no runtime deps); this file gives it
 * precise types for TypeScript consumers (e.g. the Jest suite in
 * tests/ratchet-coverage.test.ts). The signatures mirror the runtime exports.
 */

export type Metric = "branches" | "functions" | "lines" | "statements";

export interface Metrics {
  branches: number;
  functions: number;
  lines: number;
  statements: number;
}

export interface Change {
  metric: string;
  from: number;
  to: number;
  measured: number;
}

export interface Regression {
  metric: string;
  measured: number;
  current: number;
}

export interface ComputeResult {
  floors: Metrics;
  regressions: Regression[];
  bumps: Change[];
}

export type RatchetKind = "bump" | "noop" | "regression";

export interface RatchetResult {
  kind: RatchetKind;
  current: Metrics;
  floors: Metrics;
  bumps: Change[];
  regressions: Regression[];
  nextSource: string | null;
}

export const METRICS: Metric[];
export const DEFAULT_MARGIN: number;
export const BLOCK_RE: RegExp;

export function parseArgs(argv: string[]): {
  margin: number;
  coveragePath: string;
  configPath: string;
  dryRun: boolean;
};

export function readCoverageSummary(filePath: string): unknown;

export function extractMeasured(summary: unknown): Metrics;

export function readCurrentValues(inner: string): Metrics;

export function computeFloors(
  measured: Metrics,
  current: Metrics,
  margin: number,
): ComputeResult;

export function applyRatchet(
  source: string,
  measured: Metrics,
  margin: number,
): RatchetResult;

export function main(): void;
