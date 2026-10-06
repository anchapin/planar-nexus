/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const DiscardReference: CardOpReference = {
  name: "Discard",
  reference:
    '{"op":"Discard","amount":N,"who":"you"|"target_player"|"each_opponent"} (that player discards N cards of their choice; must come after every other effect, e.g. "draw two cards, then discard a card"; not random, not "you may discard", not a cost)',
};
