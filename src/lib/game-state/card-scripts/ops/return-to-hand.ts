/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const ReturnToHandReference: CardOpReference = {
  name: "ReturnToHand",
  reference:
    '{"op":"ReturnToHand","target":"creature"|"artifact"|"enchantment"|"artifact_or_enchantment"|"nonland_permanent"} (return target permanent to its owner\'s hand; same targets and options as Destroy)',
};
