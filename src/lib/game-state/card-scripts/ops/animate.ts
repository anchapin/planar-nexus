/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const AnimateReference: CardOpReference = {
  name: "Animate",
  reference:
    '{"op":"Animate","target":"self","power":N,"toughness":N,"keywords":["vigilance",...],"all_creature_types":true} (until end of turn the source also becomes a creature with that base P/T; "It\'s still a land." Soulstone Sanctuary)',
};
