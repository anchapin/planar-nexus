/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const GainLifeReference: CardOpReference = {
  name: "GainLife",
  reference: '{"op":"GainLife","amount":N|"X","who":"you"|"target_player"}',
};
