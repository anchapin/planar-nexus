/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const DestroyReference: CardOpReference = {
  name: "Destroy",
  reference:
    '{"op":"Destroy","target":"creature"|"artifact"|"enchantment"|"artifact_or_enchantment"|"nonland_permanent","min_power":N,"max_power":N} (min_power/max_power optional, creature targets only: "creature with power 4 or greater" is min_power 4; controller "you"|"opponent" optional, as for DealDamage)',
};
