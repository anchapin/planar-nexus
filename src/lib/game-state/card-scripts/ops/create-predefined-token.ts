/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const CreatePredefinedTokenReference: CardOpReference = {
  name: "CreatePredefinedToken",
  reference:
    '{"op":"CreatePredefinedToken","token":"treasure"|"food"|"clue","count":N} (you create N Treasure, Food or Clue tokens; "investigate" is one Clue; not tapped tokens, not "its controller creates")',
};
