/**
 * Combat System
 * @fileoverview MTG combat system: attacker/blocker declaration, damage resolution.
 * Reference: Comprehensive Rules 506-510
 */

export type { CombatActionResult } from "./declaration";

export {
  canAttack,
  canBlock,
  getAvailableAttackers,
  getAvailableBlockers,
} from "./queries";

export {
  declareAttackers,
  declareBlockers,
  setDamageAssignmentOrder,
} from "./declaration";

export { resolveCombatDamage } from "./resolution";
