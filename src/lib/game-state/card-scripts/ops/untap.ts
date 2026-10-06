/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const UntapReference: CardOpReference = {
  name: "Untap",
  reference:
    '{"op":"Untap","target":"creature"|"artifact"|"enchantment"|"artifact_or_enchantment"|"nonland_permanent"} (same targets and options as Destroy)',
};
