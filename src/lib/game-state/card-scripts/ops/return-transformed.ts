/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const ReturnTransformedReference: CardOpReference = {
  name: "ReturnTransformed",
  reference:
    '{"op":"ReturnTransformed","if_cast_from":"graveyard","counter":"finality"} (if this transforming double-faced spell was cast from a graveyard, it goes onto the battlefield transformed under its owner\'s control, optionally with a finality counter; otherwise nothing. Esper Origins)',
};
