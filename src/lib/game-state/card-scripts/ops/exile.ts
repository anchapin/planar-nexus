/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const ExileReference: CardOpReference = {
  name: "Exile",
  reference:
    '{"op":"Exile","target":"creature"|"artifact"|"enchantment"|"artifact_or_enchantment"|"nonland_permanent","min_power":N,"max_power":N} (same targets as Destroy)',
};
