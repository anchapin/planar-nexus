/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const CopySpellReference: CardOpReference = {
  name: "CopySpell",
  reference:
    '{"op":"CopySpell","gain":["wither"],"new_targets":true} (cast triggers only: copy the spell that was cast; gain optional; new_targets true acknowledges the "you may choose new targets" clause, copy still inherits original targets in v1)',
};
