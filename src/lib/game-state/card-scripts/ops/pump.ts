/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const PumpReference: CardOpReference = {
  name: "Pump",
  reference:
    '{"op":"Pump","power":N|"X"|"-X","toughness":N|"X"|"-X","target":"creature"|"self","controller":"you"|"opponent","double_power":true} (until end of turn; controller optional, target creature only; double_power: "double the power of target creature", power/toughness 0)',
};
