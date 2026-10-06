/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const PutCountersReference: CardOpReference = {
  name: "PutCounters",
  reference:
    '{"op":"PutCounters","counter":"+1/+1","amount":N|"X","target":"creature"|"self","controller":"you"|"opponent"} (controller optional, target creature only)',
};
