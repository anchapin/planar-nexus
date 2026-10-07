/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const ShuffleLibraryReference: CardOpReference = {
  name: "ShuffleLibrary",
  reference:
    '{"op":"ShuffleLibrary","who":"you"|"target_player","into":"library"} (CR 701.20: shuffle that player\'s library. v1 supports only "into":"library" — "shuffle your graveyard into your library" is a follow-up.)',
};
