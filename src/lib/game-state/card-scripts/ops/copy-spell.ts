/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const CopySpellReference: CardOpReference = {
  name: "CopySpell",
  reference:
    '{"op":"CopySpell","gain":["wither"]} (cast triggers only: copy the spell that was cast, same targets; gain optional)',
};
