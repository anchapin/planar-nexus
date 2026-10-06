/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const TapReference: CardOpReference = {
  name: "Tap",
  reference:
    '{"op":"Tap","target":"creature"|"artifact"|"enchantment"|"artifact_or_enchantment"|"nonland_permanent"} (same targets and options as Destroy; not "target permanent" or "creature or land")',
};
