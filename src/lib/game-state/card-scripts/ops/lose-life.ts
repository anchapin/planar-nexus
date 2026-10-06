/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const LoseLifeReference: CardOpReference = {
  name: "LoseLife",
  reference:
    '{"op":"LoseLife","amount":N|"X","who":"you"|"target_player"|"each_opponent"}',
};
