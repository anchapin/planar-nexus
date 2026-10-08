/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const CantBeBlockedReference: CardOpReference = {
  name: "CantBeBlocked",
  reference:
    '{"op":"CantBeBlocked","target":"creature"|"self"|"it","max_power":2,"controller":"you"|"opponent","until":"end_of_turn"} ("target creature [with power N or less] can\'t be blocked this turn"; max_power and controller optional, controller needs target creature; "it" reuses the previous effect\'s target; not for a static "can\'t be blocked", "can\'t be blocked except by", or "creatures you control can\'t be blocked")',
};
