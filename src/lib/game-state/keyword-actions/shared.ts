/**
 * Shared keyword-action result types (CR 701).
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstanceId } from '../types';
import { DungeonRoomCompletion } from '../../cards/dungeons';

/**
 * Result of a keyword action
 */
export interface KeywordActionResult {
  /** Whether the action was successful */
  success: boolean;
  /** Updated game state */
  state: GameState;
  /** Description of what happened */
  description: string;
  /** Cards that were affected */
  affectedCards?: CardInstanceId[];
  /** Error message if failed */
  error?: string;
  roomCompletion?: DungeonRoomCompletion;
  completedDungeonId?: string;
}

