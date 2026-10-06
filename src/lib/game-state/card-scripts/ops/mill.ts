/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const MillReference: CardOpReference = {
  name: "Mill",
  reference:
    '{"op":"Mill","amount":N|"X","who":"you"|"target_player"|"each_opponent"} (top N cards of that library into its graveyard; fixed N only, not "you may mill")',
};
