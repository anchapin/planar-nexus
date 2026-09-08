/**
 * Linked-effect types (CR 607): linked ability representations and their registry.
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import { CardInstanceId } from './cards';

export interface LinkedEffect {
  /** Unique identifier for this linked effect */
  id: string;
  /** Card that created this linked effect */
  sourceCardId: CardInstanceId;
  /** ID of the first ability (creates the linked object) */
  firstAbilityId: string;
  /** ID of the second ability (uses the linked object) */
  secondAbilityId: string;
  /** Type of link (damage→life or copy→counter) */
  linkType: "damage_life" | "copy_counter";
  /** Damage amount for damage_life links */
  damageAmount?: number;
  /** Copied card ID for copy_counter links */
  copiedCardId?: CardInstanceId;
  /** When this linked effect was created */
  timestamp: number;
}

/**
 * Registry for tracking linked effects
 */
export interface LinkedEffectRegistry {
  /** All active linked effects */
  effects: LinkedEffect[];
  /** Linked effects indexed by source card ID for fast lookup */
  bySourceCard: Map<CardInstanceId, LinkedEffect[]>;
}

