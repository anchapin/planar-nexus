/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const GrantKeywordReference: CardOpReference = {
  name: "GrantKeyword",
  reference:
    '{"op":"GrantKeyword","keyword":"indestructible","target":"creature"|"self"|"it","controller":"you"|"opponent","until":"end_of_turn"} ("target creature gains indestructible until end of turn"; "it" reuses the previous effect\'s target, so "Target creature gets +2/+2 and gains indestructible" is a Pump then a GrantKeyword with target "it"; controller optional, target creature only; not for "creatures you control gain", "indestructible from" a color, or a static "has indestructible")',
};
