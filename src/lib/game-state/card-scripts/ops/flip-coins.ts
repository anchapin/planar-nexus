/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const FlipCoinsReference: CardOpReference = {
  name: "FlipCoins",
  reference:
    '{"op":"FlipCoins","coins":N|"X","who":"you"|"target_player"|"each_opponent"|"each_player"} ' +
    '(flips N coins via state.random() < 0.5; for each heads, that player draws a card; ' +
    "X is substituted from the spell or activated ability's own {X} cost via withX; " +
    "heads/tails are not chosen by a player; for an interactive flip model it as a " +
    "waiting_choice)",
};