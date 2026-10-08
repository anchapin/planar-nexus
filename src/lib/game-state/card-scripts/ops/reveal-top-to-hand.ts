/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const RevealTopToHandReference: CardOpReference = {
  name: "RevealTopToHand",
  reference:
    '{"op":"RevealTopToHand","filter":"permanent"} (reveal the top card of your library; if it\'s a permanent card, put it into your hand, otherwise it stays on top. Summon: Esper Maduin)',
};
