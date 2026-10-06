/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const FightReference: CardOpReference = {
  name: "Fight",
  reference:
    '{"op":"Fight","fighter":"self"|"it"|"creature","target":"creature","controller":"you"|"opponent"} (fighter and target each deal damage equal to its power to the other; "it" = the creature the previous effect targeted, "creature" = a second target you choose first, which must be yours; controller optional, applies to target; "optional":true only with fighter "self")',
};
