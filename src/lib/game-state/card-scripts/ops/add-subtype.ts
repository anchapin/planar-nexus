/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const AddSubtypeReference: CardOpReference = {
  name: "AddSubtype",
  reference:
    '{"op":"AddSubtype","target":"self","subtype":"Dragon","until":"end_of_turn"} (this permanent becomes the subtype in addition to its other types until end of turn. Sarkhan, Dragon Ascendant)',
};
