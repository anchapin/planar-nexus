/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const BiteReference: CardOpReference = {
  name: "Bite",
  reference:
    '{"op":"Bite","fighter":"self"|"it"|"creature","target":"creature","controller":"you"|"opponent"} (one-sided fight: only the fighter deals damage equal to its power to target; same fighter rules as Fight)',
};
