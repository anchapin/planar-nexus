/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const GrantKeywordReference: CardOpReference = {
  name: "GrantKeyword",
  reference:
    '{"op":"GrantKeyword","keyword":"flying"|"vigilance"|"trample"|"haste"|"lifelink"|"deathtouch"|"reach"|"first strike"|"double strike"|"menace"|"hexproof"|"indestructible","target":"creature"|"self"|"it"|"permanents_you_control","subtypes":["Treefolk","Forest"],"controller":"you"|"opponent","until":"end_of_turn"} ("target creature gains X until end of turn"; same set as the equipment keyword list, widened in #2594; "it" reuses the previous effect\'s target, so "Target creature gets +2/+2 and gains indestructible" is a Pump then a GrantKeyword with target "it"; controller optional, target creature only; "permanents_you_control" fans out to every permanent you control, optionally only those with one of "subtypes" ("Treefolk and Forests you control gain indestructible until end of turn"); not for "creatures you control gain", "indestructible from" a color, or a static "has indestructible")',
};
